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
  extractWalletConnectUri,
  getWalletConnectProjectId,
  parseCaipChainId,
  supportedCaipAccounts,
  supportedCaipChains,
} from '../wallet/wc';
import { handleWalletConnectRequest } from '../wallet/wc-sign';
import { useWallet } from './WalletContext';

type SessionInfo = {
  topic: string;
  name: string;
  url: string;
};

type ProposalInfo = {
  id: number;
  name: string;
  url: string;
  raw: unknown;
};

type RequestInfo = {
  id: number;
  topic: string;
  method: string;
  params: unknown[];
  chainId: ChainId;
  peerName: string;
};

type WalletKitClient = {
  on: (event: string, handler: (payload: never) => void) => void;
  pair: (input: { uri: string }) => Promise<unknown>;
  approveSession: (input: { id: number; namespaces: unknown }) => Promise<unknown>;
  rejectSession: (input: { id: number; reason: unknown }) => Promise<unknown>;
  respondSessionRequest: (input: { topic: string; response: unknown }) => Promise<unknown>;
  disconnectSession: (input: { topic: string; reason: unknown }) => Promise<unknown>;
  getActiveSessions: () => Record<string, { topic: string; peer?: { metadata?: { name?: string; url?: string } } }>;
};

type WalletConnectContextValue = {
  projectId: string | null;
  ready: boolean;
  error: string | null;
  sessions: SessionInfo[];
  pendingProposal: ProposalInfo | null;
  pendingRequest: RequestInfo | null;
  pair: (uri: string) => Promise<void>;
  approveProposal: () => Promise<void>;
  rejectProposal: () => Promise<void>;
  approveRequest: () => Promise<void>;
  rejectRequest: () => Promise<void>;
  disconnect: (topic: string) => Promise<void>;
};

const WalletConnectContext = createContext<WalletConnectContextValue | null>(null);

function readSessions(client: WalletKitClient | null): SessionInfo[] {
  if (!client) {
    return [];
  }
  return Object.values(client.getActiveSessions()).map((session) => ({
    topic: session.topic,
    name: session.peer?.metadata?.name ?? 'dApp',
    url: session.peer?.metadata?.url ?? '',
  }));
}

export function WalletConnectProvider({ children }: { children: ReactNode }) {
  const { session, selectedChain, setSelectedChain } = useWallet();
  const projectId = getWalletConnectProjectId();
  const clientRef = useRef<WalletKitClient | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [pendingProposal, setPendingProposal] = useState<ProposalInfo | null>(null);
  const [pendingRequest, setPendingRequest] = useState<RequestInfo | null>(null);
  const address = session?.address ?? null;
  const fallbackChainId = useRef(selectedChain.id);
  fallbackChainId.current = selectedChain.id;

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
        const { Core } = await import('@walletconnect/core');
        const { WalletKit } = await import('@reown/walletkit');
        const core = new Core({ projectId });
        const kit = (await WalletKit.init({
          core,
          metadata: {
            name: 'BoreDefi Wallet',
            description: 'Non-custodial BoreDefi wallet',
            url: 'https://github.com/PWiggle/BoreDefi-wallet',
            icons: ['https://raw.githubusercontent.com/PWiggle/BoreDefi-wallet/main/assets/icon.png'],
            redirect: { native: 'boredefi://' },
          },
        })) as unknown as WalletKitClient;
        if (cancelled) {
          return;
        }
        clientRef.current = kit;
        kit.on('session_proposal', ((proposal: { id: number; params: { proposer?: { metadata?: { name?: string; url?: string } } } }) => {
          setPendingProposal({
            id: proposal.id,
            name: proposal.params.proposer?.metadata?.name ?? 'dApp',
            url: proposal.params.proposer?.metadata?.url ?? '',
            raw: proposal,
          });
        }) as (payload: never) => void);
        kit.on('session_request', ((event: {
          id: number;
          topic: string;
          params: { chainId?: string; request: { method: string; params?: unknown[] } };
        }) => {
          const chainId = parseCaipChainId(event.params.chainId ?? '') ?? fallbackChainId.current;
          const peer = readSessions(kit).find((item) => item.topic === event.topic);
          setPendingRequest({
            id: event.id,
            topic: event.topic,
            method: event.params.request.method,
            params: event.params.request.params ?? [],
            chainId,
            peerName: peer?.name ?? 'dApp',
          });
        }) as (payload: never) => void);
        kit.on('session_delete', (() => refreshSessions()) as (payload: never) => void);
        refreshSessions();
        setReady(true);
        logger.info('WalletConnect ready');
      } catch (err) {
        logger.error('WalletConnect init failed', {
          message: err instanceof Error ? err.message : 'unknown',
        });
        if (!cancelled) {
          setError('WalletConnect could not start. Rebuild the native app after installing dependencies.');
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
      throw new Error('Set EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID and rebuild to use WalletConnect.');
    }
    const extracted = extractWalletConnectUri(uri);
    if (!extracted) {
      throw new Error('That is not a WalletConnect URI.');
    }
    setError(null);
    await client.pair({ uri: extracted });
  }, []);

  const approveProposal = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingProposal || !address) {
      throw new Error('Unlock the wallet before approving a connection.');
    }
    const { buildApprovedNamespaces, getSdkError } = await import('@walletconnect/utils');
    const proposal = pendingProposal.raw as { id: number; params: unknown };
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
        },
      });
      await client.approveSession({ id: pendingProposal.id, namespaces });
      setPendingProposal(null);
      refreshSessions();
    } catch (err) {
      await client.rejectSession({
        id: pendingProposal.id,
        reason: getSdkError('USER_REJECTED'),
      });
      setPendingProposal(null);
      throw err instanceof Error ? err : new Error('Could not approve that session.');
    }
  }, [address, pendingProposal, refreshSessions]);

  const rejectProposal = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingProposal) {
      setPendingProposal(null);
      return;
    }
    const { getSdkError } = await import('@walletconnect/utils');
    await client.rejectSession({
      id: pendingProposal.id,
      reason: getSdkError('USER_REJECTED'),
    });
    setPendingProposal(null);
  }, [pendingProposal]);

  const approveRequest = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingRequest) {
      return;
    }
    if (!session) {
      throw new Error('Unlock the wallet to sign.');
    }
    try {
      const result = await handleWalletConnectRequest({
        mnemonic: session.mnemonic,
        address: session.address,
        method: pendingRequest.method,
        params: pendingRequest.params,
        chainId: pendingRequest.chainId,
      });
      if (result.kind === 'switch') {
        await setSelectedChain(result.chainId);
        await client.respondSessionRequest({
          topic: pendingRequest.topic,
          response: { id: pendingRequest.id, jsonrpc: '2.0', result: null },
        });
      } else {
        await client.respondSessionRequest({
          topic: pendingRequest.topic,
          response: { id: pendingRequest.id, jsonrpc: '2.0', result: result.value },
        });
      }
      setPendingRequest(null);
    } catch (err) {
      await client.respondSessionRequest({
        topic: pendingRequest.topic,
        response: {
          id: pendingRequest.id,
          jsonrpc: '2.0',
          error: { code: 5000, message: 'User rejected.' },
        },
      });
      setPendingRequest(null);
      throw err instanceof Error ? err : new Error('Request failed.');
    }
  }, [pendingRequest, session, setSelectedChain]);

  const rejectRequest = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !pendingRequest) {
      setPendingRequest(null);
      return;
    }
    await client.respondSessionRequest({
      topic: pendingRequest.topic,
      response: {
        id: pendingRequest.id,
        jsonrpc: '2.0',
        error: { code: 5000, message: 'User rejected.' },
      },
    });
    setPendingRequest(null);
  }, [pendingRequest]);

  const disconnect = useCallback(
    async (topic: string) => {
      const client = clientRef.current;
      if (!client) {
        return;
      }
      const { getSdkError } = await import('@walletconnect/utils');
      await client.disconnectSession({ topic, reason: getSdkError('USER_DISCONNECTED') });
      refreshSessions();
    },
    [refreshSessions],
  );

  const value = useMemo<WalletConnectContextValue>(
    () => ({
      projectId,
      ready,
      error,
      sessions,
      pendingProposal,
      pendingRequest,
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
      disconnect,
      error,
      pair,
      pendingProposal,
      pendingRequest,
      projectId,
      ready,
      rejectProposal,
      rejectRequest,
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
  if (request.method.startsWith('eth_sign') || request.method === 'personal_sign') {
    return `Sign a message for ${request.peerName} on ${CHAINS[request.chainId].name}.`;
  }
  if (request.method === 'wallet_switchEthereumChain') {
    const next = parseChainId(
      typeof request.params[0] === 'object' && request.params[0]
        ? Number.parseInt(String((request.params[0] as { chainId?: string }).chainId ?? '0x0'), 16)
        : 0,
    );
    return next ? `Switch to ${CHAINS[next].name}.` : 'Switch network.';
  }
  return `${request.method} from ${request.peerName}`;
}
