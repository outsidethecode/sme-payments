import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

async function main() {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = mod.createNestApplication();
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const srv = app.getHttpServer();
  const ts = Date.now();

  // Register buyer
  const b = await request(srv)
    .post("/api/auth/register")
    .send({
      email: `demo-buyer-${ts}@test.com`,
      password: "Test1234!",
      name: "Ahmad Al-Rashid",
      companyName: "Al-Rashid Trading Co",
      role: "BUYER",
      jurisdiction: "KSA",
    });
  const token = b.body.accessToken;

  // Register supplier
  const s = await request(srv)
    .post("/api/auth/register")
    .send({
      email: `demo-supplier-${ts}@test.com`,
      password: "Test1234!",
      name: "Fatima Noor",
      companyName: "Noor Supply Chain",
      role: "SUPPLIER",
      jurisdiction: "KSA",
    });
  const supplierId = s.body.user.id;

  // Create PO with line items
  const po = await request(srv)
    .post("/api/purchase-orders")
    .set("Authorization", `Bearer ${token}`)
    .send({
      supplierId,
      description: "Office furniture for Riyadh branch",
      lineItems: [
        {
          description: "Standing desks (adjustable)",
          quantity: 20,
          unitPricePennies: 150000,
        },
        {
          description: "Ergonomic chairs",
          quantity: 20,
          unitPricePennies: 75000,
        },
      ],
      paymentTerms: "NET_30",
      deliveryTerms: "DDP",
      deliveryAddress: "123 King Fahd Road, Riyadh",
      externalPoNumber: "EXT-2026-0042",
    });
  const poId = po.body.id;

  // Fetch evidence pack
  const pack = await request(srv)
    .get(`/api/evidence/po/${poId}/pack`)
    .set("Authorization", `Bearer ${token}`);

  console.log(JSON.stringify(pack.body, null, 2));

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
