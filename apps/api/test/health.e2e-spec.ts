import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PostgresHealthService } from "../src/infra/postgres-health.service";
import { RedisService } from "../src/infra/redis.service";

describe("Health & OpenAPI (e2e)", () => {
  let app: INestApplication;
  const postgresMock = {
    check: jest.fn(),
  };
  const redisMock = {
    check: jest.fn(),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PostgresHealthService)
      .useValue(postgresMock)
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("GET /health/live returns 200 ok", async () => {
    const res = await request(app.getHttpServer()).get("/health/live").expect(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "smile-api",
    });
  });

  it("GET /health returns 200 with db=up and redis=up when dependencies are healthy", async () => {
    postgresMock.check.mockResolvedValue({ status: "up" });
    redisMock.check.mockResolvedValue({ status: "up" });

    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toMatchObject({
      status: "ok",
      db: "up",
      redis: "up",
      service: "smile-api",
    });
  });

  it("GET /health returns 503 degraded when a dependency is down", async () => {
    postgresMock.check.mockResolvedValue({ status: "up" });
    redisMock.check.mockResolvedValue({
      status: "down",
      error: "Connection refused",
    });

    const res = await request(app.getHttpServer()).get("/health").expect(503);
    expect(res.body).toMatchObject({
      status: "degraded",
      db: "up",
      redis: "down",
    });
  });

  it("GET /api/docs-json serves the OpenAPI 3 specification", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/docs-json")
      .expect(200);
    expect(res.body.info.title).toBe("Smile Dental SaaS API");
    expect(res.body.paths["/health"]).toBeDefined();
  });
});
