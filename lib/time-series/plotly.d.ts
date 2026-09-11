// Minimal typing for the prebuilt Plotly bundle; only the calls used by the chart.
declare module "plotly.js-basic-dist-min" {
  const Plotly: {
    react: (el: HTMLElement, data: object[], layout: object, config?: object) => Promise<void>;
    purge: (el: HTMLElement) => void;
    Plots: { resize: (el: HTMLElement) => void };
  };
  export default Plotly;
}
