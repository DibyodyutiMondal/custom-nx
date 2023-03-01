import { FastifyPluginAsync } from 'fastify';

export const handlers: FastifyPluginAsync = async server => {
  server.get('/', async () => {
    return { 'hello': 'world' };
  });
}