// Minimal typings for the ml.js packages we use (they ship no TypeScript types).

declare module 'ml-cart' {
  export interface TreeOptions {
    gainFunction?: 'gini' | 'regression';
    maxDepth?: number;
    minNumSamples?: number;
  }
  export class DecisionTreeClassifier {
    constructor(options?: TreeOptions);
    train(features: number[][], labels: number[]): void;
    predict(features: number[][]): number[];
  }
  export class DecisionTreeRegression {
    constructor(options?: TreeOptions);
    train(features: number[][], values: number[]): void;
    predict(features: number[][]): number[];
  }
}

declare module 'ml-random-forest' {
  export interface RandomForestOptions {
    nEstimators?: number;
    seed?: number;
    maxFeatures?: number;
    replacement?: boolean;
    useSampleBagging?: boolean;
    treeOptions?: object;
  }
  export class RandomForestClassifier {
    constructor(options?: RandomForestOptions);
    train(features: number[][], labels: number[]): void;
    predict(features: number[][]): number[];
  }
  export class RandomForestRegression {
    constructor(options?: RandomForestOptions);
    train(features: number[][], values: number[]): void;
    predict(features: number[][]): number[];
  }
}
