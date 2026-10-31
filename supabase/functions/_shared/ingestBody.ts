// Lee el cuerpo que envían los celulares: JSON o el texto plano del SMS.

export interface IngestBody {
  text?: unknown;
  sender?: unknown;
  source?: unknown;
  userId?: unknown;
  /** Alternativa al encabezado, para apps que no dejan poner encabezados. */
  token?: unknown;
}

export type TokenProblem = 'falta' | 'formato';

/**
 * Busca el token del celular: encabezado x-finsmart-token, Authorization:
 * Bearer o el campo "token" del JSON. Quita espacios, saltos de línea y
 * caracteres invisibles que suelen colarse al copiar y pegar en el celular.
 */
export function extractToken(headers: Headers, body: IngestBody): { token: string } | { problem: TokenProblem } {
  const raw = headers.get('x-finsmart-token')
    ?? headers.get('authorization')?.replace(/^\s*Bearer\s+/i, '')
    ?? (typeof body.token === 'string' ? body.token : '');
  const token = raw.replace(/[\s\u200B-\u200D\uFEFF"']/g, '');
  if (!token) return { problem: 'falta' };
  if (!/^fs_[0-9a-f]{64}$/.test(token)) return { problem: 'formato' };
  return { token };
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

