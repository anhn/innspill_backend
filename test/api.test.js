const request = require('supertest');
const app = require('../app');

describe('AI4EDU Backend API', () => {
  describe('Health Check', () => {
    it('should return health payload (200 if DB up, 503 if not)', async () => {
      const response = await request(app).get('/health');
      expect([200, 503]).toContain(response.status);
      expect(response.body.message).toMatch(/InnSpill Backend API/i);
      expect(response.body).toHaveProperty('db');
    });
  });

  describe('Root Endpoint', () => {
    it('should return API information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('InnSpill Backend API');
      expect(response.body.endpoints).toBeDefined();
    });
  });

  describe('Chatbot Endpoints', () => {
    it('should require auth for unknown chatbot paths', async () => {
      const response = await request(app)
        .get('/api/v1/chatbot/invalid')
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should require auth for general chat', async () => {
      const response = await request(app)
        .post('/api/v1/chatbot/asks')
        .send({ message: 'hi', context: { teacherInfo: {} } })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});
