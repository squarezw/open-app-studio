export {
  explore,
  collectInteractables,
  guessTitle,
  synthesizeInput,
  heuristicDecide,
  pickFirstOption,
} from './heuristic-explorer.js';
export type { ExploreOptions, Candidate, Decision, Decider, DecisionContext } from './heuristic-explorer.js';
export { domainPriority, scoreCandidate, signatureOf } from './policy.js';
export { makeLlmDecider } from './llm-explorer.js';
export type { LlmDeciderOptions } from './llm-explorer.js';
export { runDeviceBenchmark, renderScorecard } from './benchmark.js';
export type { Scorecard, ProbeResult, ProbeStatus } from './benchmark.js';
export { Orchestrator } from './orchestrator.js';
export type { CloneRunOptions } from './orchestrator.js';
export { annotate, deriveFlows, deriveLeafFlows } from './annotator.js';
export { makeLlmAnnotator } from './llm-annotator.js';
export type { LlmAnnotatorOptions } from './llm-annotator.js';
export { detectTabBar, tabKey } from './tabbar.js';
export type { TabItem } from './tabbar.js';
export { makeVlmAnalyzers } from './entry-analyzer.js';
export type { VlmAnalyzers, EntryAnalysis, StuckAnalysis, ThemeTokens, Rect } from './entry-analyzer.js';
export { parseStoreUrl, fetchStoreMetadata, provisionalIfgFromMetadata } from './acquirer.js';
export type { StoreRef, StoreMetadata } from './acquirer.js';
