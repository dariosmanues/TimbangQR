declare module "tesseract.js" {
  export interface RecognizeResult {
    data: {
      text: string;
      confidence: number;
    };
  }

  export interface Worker {
    setParameters(params: Record<string, unknown>): Promise<void>;
    recognize(image: unknown): Promise<RecognizeResult>;
    terminate(): Promise<void>;
  }

  export function createWorker(lang?: string): Promise<Worker>;
}
