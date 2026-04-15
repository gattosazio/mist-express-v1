Core Framework: express (The web server routing).

Database ORM: sequelize

Authentication: jsonwebtoken (For creating your Level 5 clearance badges).

Vector/RAG Engine: llamaindex (The official NPM package for LlamaIndex) + @qdrant/js-client-rest (To talk to your vector DB).

Voice/WebRTC: livekit-server-sdk (For the Ticket Booth) and @livekit/agents (For the MISSU background worker).

Security & Env: dotenv (For keys), cors (For frontend communication), and helmet (Enterprise security headers for Express).