// Lee el cuerpo que envían los celulares: JSON o el texto plano del SMS.

export interface IngestBody {
  text?: unknown;
  sender?: unknown;
  source?: unknown;
  userId?: unknown;
}

export async function readIngestBody(request: Request): Promise<IngestBody> {
  const url = new URL(request.url);
  const raw = await request.text();
  const fromUrl = { sender: url.searchParams.get('sender'), source: url.searchParams.get('source') };
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    try {
      return { ...fromUrl, ...JSON.parse(raw) as IngestBody };
    } catch {
      // JSON roto (comillas del SMS): se usa el texto tal cual.
    }
  }
  return { ...fromUrl, text: raw };
}

