import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { logger } from '../logger';
import { CHAINS, parseChainId, type ChainId } from '../wallet/chains';
import {
  WALLETCONNECT_EVENTS,
  WALLETCONNECT_METHODS,
  WALLETCONNECT_RELAY_ORIGIN,
  extractWalletConnectUri,
  getWalletConnectProjectId,
  supportedCaipAccounts,
  supportedCaipChains,
} from '../wallet/wc';
import { installRelayOriginWebSocket } from '../wallet/wc-origin';
import { loadWalletConnectUtils, loadWalletKitSdk } from '../wallet/wc-sdk';
import { ETH_SIGN_BLOCKED, handleWalletConnectRequest } from '../wallet/wc-sign';
import {
  chainAllowedInSession,
  evmChainFromCaip,
  routeWalletConnectRequest,
  summarizeProposal,
  verifyStatus,
  type ProposalParams,
  type ProposalSummary,
  type VerifyContext,
  type VerifyStatus,
} from '../wallet/wc-session';
import { SOLANA_ENABLED } from '../wallet/solana/config';
import { SOLANA_WC_CHAINS, SOLANA_WC_METHODS, solanaWcChains } from '../wallet/solana/wc-solana';
import { useWallet } from './WalletContext';

installRelayOriginWebSocket();

export type SessionInfo = {
  topic: string;
  name: string;
  url: string;
  icon: string | null;
  /** Chain names this session can use. */
  chains: string[];
  expiry: number | null;
};

export type ProposalInfo = ProposalSummary & {
  id: number;
  raw: unknown;
};

export type RequestInfo = {
  id: number;
  topic: string;
  method: string;
  params: unknown[];
  /** EVM chain of the request. For Solana requests, the wallet's selected EVM chain (unused). */
  chainId: ChainId;
  /** CAIP-2 chain the dApp sent (eip155:1, solana:5eyk...). */
  caipChainId: string;
  peerName: string;
  peerUrl: string;
  verify: VerifyStatus;
};

type RawSession = {
  topic: string;
  expiry?: number;
  peer?: { metadata?: { name?: string; url?: string; icons?: string[] } };
  namespaces?: Record<string, { chains?: string[]; accounts?: string[]; methods?: string[] }>;
};

type WalletKitClient = {
  on: (event: string, handler: (payload: never) => void) => void;
  pair: (input: { uri: string }) => Promise<unknown>;
  approveSession: (input: { id: number; namespaces: unknown }) => Promise<unknown>;
  rejectSession: (input: { id: number; reason: unknown }) => Promise<unknown>;
  respondSessionRequest: (input: { topic: string; response: unknown }) => Promise<unknown>;
  disconnectSession: (input: { topic: string; reason: unknown }) => Promise<unknown>;
  getActiveSessions: () => Record<string, RawSession>;
};

type WalletConnectContextValue = {
  projectId: string | null;
  ready: boolean;
  error: string | null;
  /** Short-lived notice (e.g. a request BoreDefi refused on its own). */
  notice: string | null;
  clearNotice: () => void;
  sessions: SessionInfo[];
  pendingProposal: ProposalInfo | null;
  pendingRequest: RequestInfo | null;
  queuedRequests: number;
  pair: (uri: string) => Promise<void>;
  approveProposal: () => Promise<void>;
  rejectProposal: () => Promise<void>;
  approveRequest: (clearance?: string) => Promise<void>;
  rejectRequest: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
};

const WalletConnectContext = createContext<WalletConnectContextValue | null>(null);

const ERR_USER_REJECTED = { code: 5000, message: 'User rejected.' };
const ERR_UNSUPPORTED_METHOD = { code: 5101, message: 'Unsupported method.' };
const ERR_UNSUPPORTED_CHAIN = { code: 5100, message: 'Unsupported chain for this session.' };

function chainLabel(caip: string): string {
  if (caip.startsWith('eip155:')) {
    const id = parseChainId(caip.slice(7));
    return id ? CHAINS[id].name : caip;
  }
  return SOLANA_WC_CHAINS[caip] ?? caip;
}

function readSessions(client: WalletKitClient | null): SessionInfo[] {
  if (!client) {
    return [];
  }
  return Object.values(client.getActiveSessions()).map((session) => {
    const chains = new Set<string>();
    for (const ns of Object.values(session.namespaces ?? {})) {
      for (const caip of ns.chains ?? []) chains.add(chainLabel(caip));
      for (const account of ns.accounts ?? []) chains.add(chainLabel(account.split(':').slice(0, 2).join(':')));
    }
    return {
      topic: session.topic,
      name: session.peer?.metadata?.name ?? 'dApp',
      url: session.peer?.metadata?.url ?? '',
      icon: (session.peer?.metadata?.icons ?? []).find((item) => /^https:\/\//i.test(item)) ?? null,
      chains: [...chains],
      expiry: session.expiry ?? null,
    };
  });
}

export function WalletConnectProvider({ children }: { children: ReactNode }) {
  const { session, selectedChain, setSelectedChain, solanaAddress } = useWallet();
  const projectId = getWalletConnectProjectId();
  const clientRef = useRef<WalletKitClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [pendingProposal, setPendingProposal] = useState<ProposalInfo | null>(null);
  // Requests are answered one at a time, oldest first, so a second request never replaces an unanswered one.
  const [requests, setRequests] = useState<RequestInfo[]>([]);
  const pendingRequest = requests[0] ?? null;
  const address = session?.address ?? null;
  const addressRef = useRef(address);
  addressRef.current = address;
  const fallbackChainId = useRef(selectedChain.id);
  fallbackChainId.current = selectedChain.id;
  const solanaRef = useRef<string | null>(null);
  solanaRef.current = SOLANA_ENABLED ? solanaAddress : null;

  const refreshSessions = useCallback(() => {
    setSessions(readSessions(clientRef.current));
  }, []);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        installRelayOriginWebSocket();
        const { Core, WalletKit } = loadWalletKitSdk();
        const core = new Core({ projectId });
        const kit = (await WalletKit.init({
          core,
          metadata: {
            name: 'BoreDefi Wallet',
            description: 'Self-custody BoreDefi wallet',
            url: WALLETCONNECT_RELAY_ORIGIN,
            icons: ['https://raw.githubusercontent.com/PWiggle/BoreDefi-wallet/main/assets/icon.png'],
            redirect: { native: 'boredefi://' },
          },
        })) as unknown as WalletKitClient;
        if (cancelled) {
          return;
        }
        clientRef.current = kit;

        const respond = (topic: string, id: number, body: { result: unknown } | { error: { code: number; message: string } }) =>
          kit.respondSessionRequest({ topic, response: { id, jsonrpc: '2.0', ...body } }).catch((err: unknown) => {
            logger.warn('WalletConnect respond failed', { message: err instanceof Error ? err.message : 'unknown' });
          });

        kit.on('session_proposal', ((proposal: { id: number; params: ProposalParams; verifyContext?: VerifyContext }) => {
          const summary = summarizeProposal(proposal.params, proposal.verifyContext, {
            solanaEnabled: Boolean(solanaRef.current),
          });
          if (summary.blockedReason) {
            // Never connect the wallet to a blocked or Reown-flagged scam site.
            void kit
              .rejectSession({ id: proposal.id, reason: { code: 5000, message: 'Blocked by BoreDefi phishing protection.' } })
              .catch(() => undefined);
            setError(`Blocked: ${summary.blockedReason} Your wallet was not connected.`);
            return;
          }
          setPendingProposal({ ...summary, id: proposal.id, raw: proposal });
        }) as (payload: never) => void);

        kit.on('session_request', ((event: {
          id: number;
          topic: string;
          params: { chainId?: string; request: { method: string; params?: unknown } };
          verifyContext?: VerifyContext;
        }) => {
          const { id, topic } = event;
          const method = event.params.request.method;
          const rawParams = event.params.request.params;
          const params = Array.isArray(rawParams) ? rawParams : rawParams === undefined ? [] : [rawParams];
          const caip = event.params.chainId ?? '';
          const active = kit.getActiveSessions()[topic];
          const peerName = active?.peer?.metadata?.name ?? 'dApp';
          const verify = verifyStatus(event.verifyContext);
          const route = routeWalletConnectRequest(method);

          if (!active) {
            void respond(topic, id, { error: ERR_USER_REJECTED });
            return;
          }
          if (verify === 'scam') {
            void respond(topic, id, { error: ERR_USER_REJECTED });
            setNotice(`Blocked a request from ${peerName}: Reown Verify flagged it as a scam.`);
            return;
          }
          if (route === 'blocked') {
            void respond(topic, id, { error: { code: 5000, message: ETH_SIGN_BLOCKED } });
            setNotice(`${peerName} asked for eth_sign. ${ETH_SIGN_BLOCKED}`);
            return;
          }
          if (route === 'unsupported' || (route === 'solana' && !solanaRef.current)) {
            void respond(topic, id, { error: ERR_UNSUPPORTED_METHOD });
            return;
          }
          if (!chainAllowedInSession(caip, active.namespaces)) {
            void respond(topic, id, { error: ERR_UNSUPPORTED_CHAIN });
            return;
          }
          if (route === 'info') {
            const evm = addressRef.current;
            if (!evm) {
              void respond(topic, id, { error: ERR_USER_REJECTED });
              return;
            }
            const result =
              method === 'wallet_getCapabilities' ? {} : method === 'wallet_revokePermissions' ? null : [evm];
            void respond(topic, id, { result });
            return;
          }
          const chainId = evmChainFromCaip(caip) ?? fallbackChainId.current;
          setRequests((current) => [
            ...current,
            {
              id,
              topic,
              method,
              params,
              chainId,
              caipChainId: caip,
              peerName,
              peerUrl: active.peer?.metadata?.url ?? '',
              verify,
            },
          ]);
        }) as (payload: never) => void);

        const dropTopic = (payload: { topic?: string }) => {
          if (payload?.topic) {
            setRequests((current) => current.filter((item) => item.topic !== payload.topic));
          }
          refreshSessions();
        };
        kit.on('session_delete', dropTopic as (payload: never) => void);
        kit.on('session_expire', dropTopic as (payload: never) => void);
        kit.on('proposal_expire', ((payload: { id?: number }) => {
          setPendingProposal((current) => (current && current.id === payload?.id ? null : current));
        }) as (payload: never) => void);
        kit.on('session_request_expire', ((payload: { id?: number }) => {
          setRequests((current) => current.filter((item) => item.id !== payload?.id));
        }) as (payload: never) => void);
        refreshSessions();
        setReady(true);
        logger.info('WalletConnect ready');
      } catch (err) {
        logger.error('WalletConnect init failed', {
          message: err instanceof Error ? err.message : 'unknown',
        });
        if (!cancelled) {
          setError('WalletConnect could not start. Check your connection and reopen the app.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshSessions]);

  const pair = useCallback(async (uri: string) => {
    const client = clientRef.current;
    if (!client) {
      throw new Error('WalletConnect is still starting. Try again in a moment.');
    }
    if (!uri || !uri.trim()) {
      throw new Error('Paste or scan a WalletConnect link first. It starts with wc:');
    }
    const extracted = extractWalletConnectUri(uri);
    if (!extracted) {
      throw new Error("That isn't a WalletConnect link. Copy the wc: link from the dApp, or tap Scan QR.");
    }
    setError(null);
    try {
      await client.pair({ uri: extracted });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (/expired/i.test(message)) {
        throw new Error('That WalletConnect link has expired. Refresh the QR code on the dApp and try again.');
      }
      if (/already exists|pairing already/i.test(message)) {
        throw new Error('That link was already used. Ask the dApp for a fresh QR code.');
      }
      throw err instanceof Error ? err : new Error('Could not pair.');
    }
  }, []);

  const approveProposal = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingProposal || !address) {
      throw new Error('Unlock the wallet before approving a connection.');
    }
    const { buildApprovedNamespaces, getSdkError } = loadWalletConnectUtils();
    const proposal = pendingProposal.raw as { id: number; params: unknown };
    const solana = solanaRef.current;
    try {
      const namespaces = buildApprovedNamespaces({
        proposal: proposal.params as Parameters<typeof buildApprovedNamespaces>[0]['proposal'],
        supportedNamespaces: {
          eip155: {
            chains: supportedCaipChains(),
            methods: [...WALLETCONNECT_METHODS],
            events: [...WALLETCONNECT_EVENTS],
            accounts: supportedCaipAccounts(address),
          },
          ...(solana
            ? {
                solana: {
                  chains: solanaWcChains(),
                  methods: [...SOLANA_WC_METHODS],
                  events: [],
                  accounts: solanaWcChains().map((caip) => `${caip}:${solana}`),
                },
              }
            : {}),
        },
      });
      await client.approveSession({ id: pendingProposal.id, namespaces });
      setPendingProposal(null);
      refreshSessions();
    } catch (err) {
      await client
        .rejectSession({
          id: pendingProposal.id,
          reason: getSdkError('UNSUPPORTED_NAMESPACE_KEY'),
        })
        .catch(() => undefined);
      setPendingProposal(null);
      const message = err instanceof Error ? err.message : '';
      throw new Error(
        /chain|namespace/i.test(message)
          ? "This dApp needs a network BoreDefi doesn't support, so it wasn't connected."
          : 'Could not approve that connection.',
      );
    }
  }, [address, pendingProposal, refreshSessions]);

  const rejectProposal = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingProposal) {
      setPendingProposal(null);
      return;
    }
    const { getSdkError } = loadWalletConnectUtils();
    await client
      .rejectSession({
        id: pendingProposal.id,
        reason: getSdkError('USER_REJECTED'),
      })
      .catch(() => undefined);
    setPendingProposal(null);
  }, [pendingProposal]);

  const finishRequest = useCallback((request: RequestInfo) => {
    setRequests((current) => current.filter((item) => !(item.id === request.id && item.topic === request.topic)));
  }, []);

  const approveRequest = useCallback(async (clearance?: string) => {
    const client = clientRef.current;
    const request = pendingRequest;
    if (!client || !request) {
      return;
    }
    if (!session) {
      throw new Error('Unlock the wallet to sign.');
    }
    try {
      const result = await handleWalletConnectRequest({
        mnemonic: session.mnemonic,
        address: session.address,
        method: request.method,
        params: request.params,
        chainId: request.chainId,
        clearance,
        solanaAddress: solanaRef.current,
      });
      if (result.kind === 'switch') {
        await setSelectedChain(result.chainId);
        await client.respondSessionRequest({
          topic: request.topic,
          response: { id: request.id, jsonrpc: '2.0', result: null },
        });
      } else {
        await client.respondSessionRequest({
          topic: request.topic,
          response: { id: request.id, jsonrpc: '2.0', result: result.value },
        });
      }
      finishRequest(request);
    } catch (err) {
      await client
        .respondSessionRequest({
          topic: request.topic,
          response: {
            id: request.id,
            jsonrpc: '2.0',
            error: ERR_USER_REJECTED,
          },
        })
        .catch(() => undefined);
      finishRequest(request);
      const message = err instanceof Error ? err.message : 'Request failed.';
      // The sheet closes with the request, so the reason is kept as a notice.
      setNotice(`Not signed. ${message}`);
      throw err instanceof Error ? err : new Error(message);
    }
  }, [finishRequest, pendingRequest, session, setSelectedChain]);

  const rejectRequest = useCallback(async () => {
    const client = clientRef.current;
    const request = pendingRequest;
    if (!client || !request) {
      setRequests([]);
      return;
    }
    await client
      .respondSessionRequest({
        topic: request.topic,
        response: {
          id: request.id,
          jsonrpc: '2.0',
          error: ERR_USER_REJECTED,
        },
      })
      .catch(() => undefined);
    finishRequest(request);
  }, [finishRequest, pendingRequest]);

  const disconnect = useCallback(
    async (topic: string) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      const { getSdkError } = loadWalletConnectUtils();
      try {
        await client.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
      } finally {
        setRequests((current) => current.filter((item) => item.topic !== topic));
        refreshSessions();
      }
    },
    [refreshSessions],
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<WalletConnectContextValue>(
    () => ({
      projectId,
      ready,
      error,
      notice,
      clearNotice,
      sessions,
      pendingProposal,
      pendingRequest,
      queuedRequests: Math.max(0, requests.length - 1),
      pair,
      approveProposal,
      rejectProposal,
      approveRequest,
      rejectRequest,
      disconnect,
    }),
    [
      approveProposal,
      approveRequest,
      clearNotice,
      disconnect,
      error,
      notice,
      pair,
      pendingProposal,
      pendingRequest,
      projectId,
      ready,
      rejectProposal,
      rejectRequest,
      requests.length,
      sessions,
    ],
  );

  return <WalletConnectContext.Provider value={value}>{children}</WalletConnectContext.Provider>;
}

export function useWalletConnect(): WalletConnectContextValue {
  const value = useContext(WalletConnectContext);
  if (!value) {
    throw new Error('useWalletConnect must be used inside WalletConnectProvider');
  }
  return value;
}

export function describeRequest(request: RequestInfo): string {
  if (request.method === 'eth_sendTransaction') {
    const tx = request.params[0] as { to?: string; value?: string } | undefined;
    return `Send a transaction on ${CHAINS[request.chainId].name}${tx?.to ? ` to ${tx.to}` : ''}.`;
  }
  if (request.method === 'solana_signMessage') {
    return `Sign a Solana message for ${request.peerName}.`;
  }
  if (request.method === 'solana_signTransaction') {
    return `Sign a Solana transaction for ${request.peerName}. BoreDefi does not send it; the dApp does.`;
  }
  if (request.method.startsWith('eth_sign') || request.method === 'personal_sign') {
    return `Sign a message for ${request.peerName} on ${CHAINS[request.chainId].name}.`;
  }
  if (request.method === 'wallet_switchEthereumChain' || request.method === 'wallet_addEthereumChain') {
    const next = parseChainId(
      typeof request.params[0] === 'object' && request.params[0]
        ? Number.parseInt(String((request.params[0] as { chainId?: string }).chainId ?? '0x0'), 16)
        : 0,
    );
    return next ? `Switch to ${CHAINS[next].name}.` : 'Switch network.';
  }
  return `${request.method} from ${request.peerName}`;
}
