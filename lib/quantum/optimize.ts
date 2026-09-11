// Adam gradient ascent with central finite differences. The simulator is exact, so
// finite differences are accurate; on hardware you would use the parameter-shift rule.

export interface OptimizerStep {
  x: number[];
  value: number;
  gradNorm: number;
  step: number;
  done: boolean;
}

interface Options {
  lr?: number;
  maxSteps?: number;
  eps?: number;
  tol?: number;
}

export function* adamAscent(
  f: (x: number[]) => number,
  x0: number[],
  { lr = 0.04, maxSteps = 250, eps = 1e-5, tol = 2e-4 }: Options = {},
): Generator<OptimizerStep> {
  const x = [...x0];
  const m = new Array(x.length).fill(0);
  const v = new Array(x.length).fill(0);
  const b1 = 0.9;
  const b2 = 0.999;

  for (let step = 1; step <= maxSteps; step++) {
    const grad = x.map((_, i) => {
      const up = [...x];
      const down = [...x];
      up[i] += eps;
      down[i] -= eps;
      return (f(up) - f(down)) / (2 * eps);
    });
    const gradNorm = Math.hypot(...grad);
    for (let i = 0; i < x.length; i++) {
      m[i] = b1 * m[i] + (1 - b1) * grad[i];
      v[i] = b2 * v[i] + (1 - b2) * grad[i] ** 2;
      const mh = m[i] / (1 - b1 ** step);
      const vh = v[i] / (1 - b2 ** step);
      x[i] += (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
    const done = gradNorm < tol || step === maxSteps;
    yield { x: [...x], value: f(x), gradNorm, step, done };
    if (done) return;
  }
}
