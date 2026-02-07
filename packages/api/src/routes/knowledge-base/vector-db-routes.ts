/**
 * Vector Database Routes
 *
 * API endpoints for vector database management.
 */

import type { FastifyInstance } from 'fastify';
import type { VectorDBManagementService } from '../../services/knowledge-base/VectorDBManagementService.js';
import type { VectorSearchRequest, CreateCollectionRequest } from '@tamma/shared';

export function registerVectorDBRoutes(
  app: FastifyInstance,
  service: VectorDBManagementService,
): void {
  // GET /vector-db/collections - List all collections
  app.get('/vector-db/collections', async (_request, reply) => {
    const collections = await service.listCollections();
    return reply.send(collections);
  });

  // POST /vector-db/collections - Create a new collection
  app.post('/vector-db/collections', async (request, reply) => {
    try {
      const body = request.body as CreateCollectionRequest;
      await service.createCollection(body.name, body.dimensions);
      return reply.status(201).send({ message: `Collection ${body.name} created` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(409).send({ error: message });
    }
  });

  // GET /vector-db/collections/:name/stats - Get collection statistics
  app.get('/vector-db/collections/:name/stats', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      const stats = await service.getCollectionStats(params.name);
      return reply.send(stats);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(404).send({ error: message });
    }
  });

  // DELETE /vector-db/collections/:name - Delete a collection
  app.delete('/vector-db/collections/:name', async (request, reply) => {
    try {
      const params = request.params as { name: string };
      await service.deleteCollection(params.name);
      return reply.send({ message: `Collection ${params.name} deleted` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(404).send({ error: message });
    }
  });

  // POST /vector-db/search - Test similarity search
  app.post('/vector-db/search', async (request, reply) => {
    try {
      const body = request.body as VectorSearchRequest;
      const results = await service.search(body);
      return reply.send(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(400).send({ error: message });
    }
  });

  // GET /vector-db/storage - Get storage usage
  app.get('/vector-db/storage', async (_request, reply) => {
    const usage = await service.getStorageUsage();
    return reply.send(usage);
  });
}
