// Single source of truth for site copy and the demo catalogue.
// Pages, navigation and metadata are all generated from this file.

export const site = {
  name: "Marco Antonio Roca",
  shortName: "Marco Roca",
  role: "AI and software engineer",
  location: "Madrid",
  statement:
    "I build machine learning systems and research how variational quantum algorithms learn their parameters. This site collects small demos of both that run in your browser.",
  // TODO: fill in before publishing. Links with an empty href are not rendered.
  links: [
    { label: "GitHub", href: "https://github.com/marrocrod" },
    { label: "LinkedIn", href: "https://www.linkedin.com/in/-marco-roca-/" },
    { label: "Email", href: "marcorocarodgmail.com" },
  ],
} as const;

export type SectionId = "ai" | "quantum";
export type DemoStatus = "live" | "building";

export interface Demo {
  slug: string;
  title: string;
  summary: string;
  /** What a visitor will be able to do once the demo is finished. */
  capabilities: string[];
  stack: string[];
  status: DemoStatus;
}

export interface Section {
  id: SectionId;
  title: string;
  intro: string;
  demos: Demo[];
}

export const sections: Record<SectionId, Section> = {
  ai: {
    id: "ai",
    title: "Machine learning",
    intro:
      "Speech, vision, forecasting and classic unsupervised learning. Models run in your browser where possible; anything heavier goes through a rate-limited server route.",
    demos: [
      {
        slug: "voice-chat",
        title: "Voice assistant",
        summary:
          "Ask questions about my work out loud and hear the answer. Speech is transcribed by Deepgram, answered by an open model on Hugging Face and spoken back by ElevenLabs.",
        capabilities: [
          "Hold a spoken conversation from the microphone, with live transcription on screen.",
          "Ask about my projects, research and experience and get grounded answers.",
          "Switch between voice and text input at any point.",
        ],
        stack: ["Deepgram", "Hugging Face Inference Providers", "ElevenLabs", "Next.js route handlers", "Upstash rate limiting"],
        status: "building",
      },
      {
        slug: "vision",
        title: "Object detection in the browser",
        summary:
          "YOLO running on your webcam or on a photo you upload. Inference happens on your device, so no image is sent anywhere.",
        capabilities: [
          "Detect objects on a live webcam feed or on an uploaded image.",
          "Adjust the confidence and overlap thresholds and see boxes update.",
          "Compare WebGPU and WebAssembly inference speed on your own hardware.",
        ],
        stack: ["YOLO11n", "ONNX", "ONNX Runtime Web", "WebGPU"],
        status: "building",
      },
      {
        slug: "time-series",
        title: "Spanish electricity forecasting",
        summary:
          "Day-ahead forecasts of electricity demand and price in Spain, built from Red Eléctrica data and refreshed daily.",
        capabilities: [
          "Browse historical demand and price with zoom and range selection.",
          "Compare classical and neural forecasts against what actually happened.",
          "Change the forecast horizon and inspect prediction intervals.",
        ],
        stack: ["REE open data API", "statsmodels", "PyTorch", "GitHub Actions", "Plotly"],
        status: "building",
      },
      {
        slug: "clustering",
        title: "Clustering and classification playground",
        summary:
          "Draw points on a canvas, pick an algorithm and watch clusters and decision boundaries change as you edit the data.",
        capabilities: [
          "Place and remove points by hand or load a preset dataset.",
          "Run k-means, DBSCAN, Gaussian mixtures, SVMs and a small neural network.",
          "Tune each algorithm's parameters and see the result immediately.",
        ],
        stack: ["TypeScript", "Canvas", "Web Workers"],
        status: "building",
      },
    ],
  },
  quantum: {
    id: "quantum",
    title: "Quantum computing",
    intro:
      "Variational algorithms, optimization and quantum machine learning. Circuits are simulated in your browser with a small state-vector simulator; research results come from my own experiments.",
    demos: [
      {
        slug: "qaoa",
        title: "QAOA for MaxCut",
        summary:
          "Draw a graph, choose the circuit depth and explore the parameter landscape that QAOA has to optimize.",
        capabilities: [
          "Build a graph by hand or pick a standard family.",
          "See the energy landscape over γ and β and where different optimizers end up.",
          "Inspect the output distribution and compare it with the exact maximum cut.",
        ],
        stack: ["TypeScript state-vector simulator", "Canvas"],
        status: "building",
      },
      {
        slug: "vqe",
        title: "VQE and energy landscapes",
        summary:
          "Molecular ground-state energies found with VQE, and the landscapes behind them, drawn from my parameter-learning research.",
        capabilities: [
          "Follow a bond-dissociation curve and compare VQE with the exact energy.",
          "Explore slices of the energy landscape for different ansätze.",
          "Read the accompanying research article and its benchmark results.",
        ],
        stack: ["PennyLane", "lightning.gpu", "Precomputed results", "Plotly"],
        status: "building",
      },
      {
        slug: "qml",
        title: "Quantum classifier",
        summary:
          "A data re-uploading classifier trained on the same 2D datasets as the classical playground, so the two can be compared directly.",
        capabilities: [
          "Train a small quantum classifier in your browser and watch the boundary form.",
          "Change the number of layers and qubits and see the effect on accuracy.",
          "Put its decision boundary next to a classical model on the same data.",
        ],
        stack: ["TypeScript state-vector simulator", "Parameter-shift gradients"],
        status: "building",
      },
      {
        slug: "qubo",
        title: "QUBO: annealing and QAOA",
        summary:
          "One optimization problem, two approaches. Simulated annealing and QAOA solve the same QUBO side by side.",
        capabilities: [
          "Generate a QUBO instance or write one by hand.",
          "Watch simulated annealing cool down and QAOA optimize, step by step.",
          "Compare solution quality and cost as the problem grows.",
        ],
        stack: ["Simulated annealing", "TypeScript state-vector simulator"],
        status: "building",
      },
    ],
  },
};

export const sectionOrder: SectionId[] = ["ai", "quantum"];

export function getDemo(section: SectionId, slug: string): Demo {
  const demo = sections[section].demos.find((d) => d.slug === slug);
  if (!demo) throw new Error(`Unknown demo: ${section}/${slug}`);
  return demo;
}

export const statusLabel: Record<DemoStatus, string> = {
  live: "Ready to use",
  building: "In progress",
};
