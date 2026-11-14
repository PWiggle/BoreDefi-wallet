module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
    overrides: [
      {
        // Ledger's DMK / signer kits ship constructors like `constructor(a, f = (x) => new Task(this.api, x))`.
        // hermesc 250829098 segfaults on a `this` arrow inside a constructor default parameter, so lower
        // default parameters for those packages only.
        test: (filename) => typeof filename === 'string' && /node_modules[\\/]@ledgerhq[\\/]/.test(filename),
        plugins: ['@babel/plugin-transform-parameters'],
      },
    ],
  };
};
