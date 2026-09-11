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
          "Talk from your microphone and watch the live transcription as you speak.",
          "Ask about my projects, research and experience in English or Spanish.",
          "Type instead of talking, and turn spoken replies off whenever you like.",
        ],
        stack: ["Deepgram Nova-3", "Llama 3.3 70B via Hugging Face Inference Providers", "ElevenLabs Flash v2.5", "Next.js route handlers", "Upstash rate limiting"],
        status: "live",
      },
            {
        slug: "vision",
        title: "Object detection in the browser",
        summary:
          "YOLO running on your webcam or on a photo you upload. Inference happens on your device, so no image is sent anywhere.",
        capabilities: [
          "Detect the 80 COCO object classes on a live camera feed or on a photo.",
          "Adjust the confidence and overlap thresholds and see the boxes update instantly.",
          "Switch between WebGPU and WebAssembly to compare inference speed on your own hardware.",
        ],
        stack: ["YOLO11n (Ultralytics)", "ONNX", "ONNX Runtime Web", "WebGPU", "WebAssembly"],
        status: "live",
      },
            {
        slug: "time-series",
        title: "Spanish electricity forecasting",
        summary:
          "Forecasts of electricity demand and day-ahead prices in Spain for the next 48 hours, built from Red Eléctrica data and refreshed every morning.",
        capabilities: [
          "Compare a seasonal baseline, gradient boosting and a neural network, plus Red Eléctrica's own demand forecast.",
          "See each forecast with an 80% prediction interval taken from its recent errors.",
          "Look back at the last two weeks of forecasts against what actually happened, with accuracy scores for every model.",
        ],
        stack: ["REE REData API", "pandas", "scikit-learn", "GitHub Actions", "Plotly"],
        status: "live",
      },
            {
        slug: "clustering",
        title: "Clustering and classification playground",
        summary:
          "Draw points on a canvas, pick an algorithm and watch clusters and decision boundaries change as you edit the data.",
        capabilities: [
          "Place and remove points by hand or load one of four standard toy datasets.",
          "Find groups with k-means, DBSCAN or a Gaussian mixture, and see centres, noise and covariance ellipses.",
          "Separate labelled classes with k-nearest neighbours, an RBF support vector machine or a neural network that trains live.",
        ],
        stack: ["TypeScript", "Canvas", "Algorithms written from scratch, no ML libraries"],
        status: "live",
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
          "Draw a graph, choose the circuit depth and watch QAOA learn its angles, simulated exactly in your browser.",
        capabilities: [
          "Build a graph by hand or start from a ring, a cube, a complete graph or a random one.",
          "Explore the exact depth-1 energy landscape and pick where the optimizer starts.",
          "Compare starting strategies at higher depth, including INTERP, and see how often the circuit finds an optimal cut.",
        ],
        stack: ["TypeScript state-vector simulator", "Closed-form depth-1 expectation", "Adam optimizer", "Canvas and SVG"],
        status: "live",
      },
      {
        slug: "vqe",
        title: "VQE and the orbital-gauge problem",
        summary:
          "Run VQE on the hydrogen molecule live, then see the central finding of my parameter-learning study: molecular orbital signs are a hidden gauge that breaks naive benchmarks.",
        capabilities: [
          "Solve H₂ along its dissociation curve with a Givens-rotation ansatz and compare it with Hartree-Fock and the exact energy.",
          "See how three orbital sign conventions change the qubit encoding of H₆, with the study's ansatz-free diagnostic recomputed from PennyLane.",
          "Read the benchmark results: a learned model reaching the ansatz floor at one circuit evaluation per geometry.",
        ],
        stack: ["PennyLane qchem (STO-3G, Jordan-Wigner)", "TypeScript Givens-ansatz simulator", "Adam optimizer", "SVG charts"],
        status: "live",
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
