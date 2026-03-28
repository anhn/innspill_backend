const request = require('supertest');
const app = require('../app');

describe('AI4EDU Backend API', () => {
  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('AI4EDU Backend API');
    });
  });

  describe('Root Endpoint', () => {
    it('should return API information', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('AI4EDU Backend API');
      expect(response.body.endpoints).toBeDefined();
    });
  });

  describe('Chatbot Endpoints', () => {
    it('should return 404 for invalid endpoint', async () => {
      const response = await request(app)
        .get('/api/v1/chatbot/invalid')
        .expect(404);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Endpoint not found');
    });

    it('should validate request format', async () => {
      const response = await request(app)
        .post('/api/v1/chatbot/asks')
        .send({})
        .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid request format');
    });
  });
});
