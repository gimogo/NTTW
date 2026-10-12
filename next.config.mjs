import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(__dirname, "src/lib/stub-module.js");

// WalletConnect is opt-in at build time. When NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
// is set the QR-modal provider is bundled; otherwise it is stubbed out so the
// default build never reads `@walletconnect/ethereum-provider` -> appkit ->
// qrcode -> pngjs. The app already ships WalletConnect-off by default (the
// connector is only registered when a project id exists), so this keeps the
// heavy QR chain out of the bundle entirely. Set the project id and rebuild to
// enable it.
const walletConnectEnabled = Boolean(
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
    // Silence Node.js core-module warnings coming from viem/wagmi optional deps.
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // `wagmi/connectors` re-exports every connector from a single barrel, so
    // importing only `injected`/`walletConnect` still pulls in `baseAccount`
    // -> @base-org/account -> @coinbase/cdp-sdk -> @x402/* (optional Coinbase
    // payment peers that pnpm does not install). We never touch those code
    // paths, so alias the known ones and exhaustively stub the rest.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      // React Native peer of @metamask/sdk (browser-only here) that pnpm
      // does not install; the connector barrel pulls it in transitively.
      "@react-native-async-storage/async-storage": false,
      "@react-native-async-storage/async-storage/lib/commonjs/index.js": false,
      "@react-native-async-storage/async-storage/lib/module/index.js": false,
      // Legacy package alias still imported by @wagmi/connectors' Coinbase
      // connector. We never use it, so point it at the empty stub.
      "cbw-sdk": STUB,
    };

    // Catch any other @x402/* subpath so the build never whack-a-moles again.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@x402\//, (resource) => {
        resource.request = STUB;
      })
    );

    // Keep the WalletConnect QR chain (appkit -> qrcode -> pngjs) out of the
    // build unless WalletConnect is explicitly enabled with a project id.
    if (!walletConnectEnabled) {
      config.resolve.alias["@walletconnect/ethereum-provider"] = STUB;
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@walletconnect\//,
          (resource) => {
            resource.request = STUB;
          }
        )
      );
    }

    return config;
  },
};

export default nextConfig;
