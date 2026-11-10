import { envFromProcess, handleOnrampRequest } from '../server/onramp/handler';

export function POST(request: Request): Promise<Response> {
  return handleOnrampRequest(request, envFromProcess());
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleOnrampRequest(request, envFromProcess());
}

export function GET(): Response {
  return new Response(JSON.stringify({ error: 'Use POST /api/onramp-session.' }), {
    status: 405,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
