// Empty stub. `@x402/*` are optional payment-SDK peers of
// @coinbase/cdp-sdk that pnpm never installs. They get pulled in only via
// the wagmi/connectors barrel -> baseAccount -> @base-org/account chain,
// which this app never calls. Redirecting them here lets the build resolve
// without shipping dead Coinbase code.
module.exports = {};
