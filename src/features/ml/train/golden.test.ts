import { describe, expect, it } from 'vitest';
import reference from '../../../../tests/golden/sklearn-reference.json';
import { accuracy, logLoss, macroPrf, mae, r2, rmse, rocAuc } from '@/features/ml/train/metrics';
import { modelZoo, type ModelContext } from '@/features/ml/train/models';

const CLASSIFICATION: ModelContext = { task: 'classification', classCount: 3, seed: 42 };
const REGRESSION: ModelContext = { task: 'regression', classCount: 0, seed: 42 };

function model(key: 'linear' | 'knn', context: ModelContext) {
  return modelZoo(context.task).find((candidate) => candidate.key === key)!;
}

describe('scikit-learn golden fixture', () => {
  it('records its generator versions and non-empty reference cases', () => {
    expect(reference.provenance).toEqual({
      generator: 'tests/golden/generate.py',
      python: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      scikitLearn: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    });
    expect(reference.metrics.classification.yTrue.length).toBeGreaterThan(0);
    expect(reference.models.linear.XTrain.length).toBeGreaterThan(0);
    expect(reference.models.knnClassifier.XTrain.length).toBeGreaterThan(0);
    expect(reference.models.knnRegressor.XTrain.length).toBeGreaterThan(0);
  });
});

describe('scikit-learn golden metrics', () => {
  it('matches classification metrics on a three-class reference', () => {
    const fixture = reference.metrics.classification;
    expect(accuracy(fixture.yTrue, fixture.yPred)).toBeCloseTo(fixture.accuracy!, 12);
    expect(macroPrf(fixture.yTrue, fixture.yPred, 3)).toEqual({
      precision: expect.closeTo(fixture.precision!, 12),
      recall: expect.closeTo(fixture.recall!, 12),
      f1: expect.closeTo(fixture.f1!, 12),
    });
    expect(logLoss(fixture.yTrue, fixture.probabilities)).toBeCloseTo(fixture.logLoss!, 12);
  });

  it('matches binary ROC-AUC, including tied scores', () => {
    const fixture = reference.metrics.binaryRoc;
    expect(rocAuc(fixture.yTrue, fixture.scores)).toBeCloseTo(fixture.rocAuc!, 12);
  });

  it('matches regression metrics', () => {
    const fixture = reference.metrics.regression;
    expect(rmse(fixture.yTrue, fixture.yPred)).toBeCloseTo(fixture.rmse!, 12);
    expect(mae(fixture.yTrue, fixture.yPred)).toBeCloseTo(fixture.mae!, 12);
    expect(r2(fixture.yTrue, fixture.yPred)).toBeCloseTo(fixture.r2!, 12);
  });
});

describe('scikit-learn golden model predictions', () => {
  it('matches ridge predictions with the same regularized bias column', () => {
    const fixture = reference.models.linear;
    const trained = model('linear', REGRESSION).train(fixture.XTrain, fixture.yTrain, REGRESSION);
    expect(trained.predict(fixture.XTest)).toEqual(
      fixture.predictions.map((prediction) => expect.closeTo(prediction, 9)),
    );
  });

  it('matches 5-neighbor classification labels and probabilities', () => {
    const fixture = reference.models.knnClassifier;
    const trained = model('knn', CLASSIFICATION).train(
      fixture.XTrain,
      fixture.yTrain,
      CLASSIFICATION,
    );
    expect(trained.predict(fixture.XTest)).toEqual(fixture.predictions);
    expect(trained.predictProba!(fixture.XTest)).toEqual(
      fixture.probabilities.map((row) => row.map((value) => expect.closeTo(value, 12))),
    );
  });

  it('matches 5-neighbor regression predictions', () => {
    const fixture = reference.models.knnRegressor;
    const trained = model('knn', REGRESSION).train(fixture.XTrain, fixture.yTrain, REGRESSION);
    expect(trained.predict(fixture.XTest)).toEqual(
      fixture.predictions.map((prediction) => expect.closeTo(prediction, 12)),
    );
  });
});
