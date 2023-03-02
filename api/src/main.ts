import fastify from 'fastify';
import { sleep } from 'utils';
import { handlers } from './handlers';

const host = '0.0.0.0';
const port = 9100;

setupServer()
  .then(server => server.listen({ host, port }))
  .then(() => {
    console.log('server started...');
    console.log('port: ' + port);
  });

async function setupServer() {

  console.debug('calling some library function');
  await sleep(6000);
  console.debug('finished calling library function');

  const server = fastify();

  await server.register(handlers);

  return server;
}