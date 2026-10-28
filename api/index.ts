import { handle } from 'hono/vercel';
import { app } from '../src/index.ts';

export default handle(app);
