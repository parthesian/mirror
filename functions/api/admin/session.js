import { requireAdmin } from '../../_lib/access.js';
import { errorResponse, handleOptions, json } from '../../_lib/http.js';

export async function onRequest(context) {
    try {
        switch (context.request.method) {
            case 'GET': {
                const auth = requireAdmin(context.request, context.env);
                if (!auth.ok) {
                    return auth.response;
                }

                return json({
                    authenticated: true,
                    email: auth.email
                });
            }
            case 'OPTIONS':
                return handleOptions();
            default:
                return errorResponse('Method not allowed.', 405);
        }
    } catch (error) {
        console.error('Failed to resolve admin session:', error);
        return errorResponse('Failed to verify admin session.', 500, error.message);
    }
}
