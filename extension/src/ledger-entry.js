import Eth from '@ledgerhq/hw-app-eth';
import TransportWebHID from '@ledgerhq/hw-transport-webhid';

const PATH = "44'/60'/0'/0/0";

let transport = null;

export async function connect() {
  transport = await TransportWebHID.create();
  const eth = new Eth(transport);
  const { address } = await eth.getAddress(PATH);
  return { address, path: PATH };
}

export async function signRaw(rawTxHex) {
  if (!transport) {
    throw new Error('Connect Ledger first.');
  }
  const eth = new Eth(transport);
  return eth.signTransaction(PATH, rawTxHex.replace(/^0x/i, ''), null);
}

export async function disconnect() {
  try {
    await transport?.close();
  } catch {
    // Device already gone.
  }
  transport = null;
}
