import { createConfig, http, type CreateConnectorFn } from "wagmi";
import { baseSepolia, robinhood } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Network support is intentionally limited to Robinhood Chain (mainnet) and
 * Base Sepolia (testnet).
 *
 * WalletConnect is optional: the connector (and its QR-modal dependency chain,
 * `@walletconnect/ethereum-provider` -> appkit -> qrcode) is only loaded when a
 * project id is configured, so the board works with injected wallets alone.
 * The heavy QR chain is additionally stubbed out at build time unless a project
 * id is present (see next.config.mjs), so a default build never bundles it.
 */
const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

/**
 * Assemble the connector list. `injected` is always registered; WalletConnect
 * is added only when a project id is configured. Built synchronously so
 * `config` is a real `Config` (wagmi's `Register` typing) with no top-level
 * await. The `require` sits behind the `if`, and the QR provider is stubbed in
 * the build when WalletConnect is disabled, so the heavy chain stays out of the
 * default bundle.
 */
function buildConnectors(): CreateConnectorFn[] {
  const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];

  if (walletConnectProjectId) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { walletConnect } =
      require("wagmi/connectors") as typeof import("wagmi/connectors");
    connectors.push(
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        metadata: {
          name: "Notes To The World",
          description: "A decentralized sticky-note corkboard",
          url:
            typeof window !== "undefined"
              ? window.location.origin
              : "https://localhost",
          icons: [],
        },
      }) as CreateConnectorFn
    );
  }

  return connectors;
}

export const config = createConfig({
  // Robinhood Chain (mainnet) first so it is the default chain the board
  // reads from. Flip the order to [baseSepolia, robinhood] to default to
  // the testnet.
  chains: [robinhood, baseSepolia],
  connectors: buildConnectors(),
  transports: {
    [robinhood.id]: http(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
