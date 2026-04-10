module.exports = {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.(ts|mts)$": ["ts-jest", { useESM: true }]
  },
  extensionsToTreatAsEsm: [".ts"],
  transformIgnorePatterns: [],
  moduleNameMapper: {
    "^(\.{1,2}/.*)\\.js$": "$1"
  }
};
