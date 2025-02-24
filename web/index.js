
import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import serveStatic from "serve-static";

import shopify from "./shopify.js";
import { DeliveryMethod } from "@shopify/shopify-api";

const PORT = parseInt(
  process.env.BACKEND_PORT || process.env.PORT || "3000",
  10
);

const STATIC_PATH =
  process.env.NODE_ENV === "production"
    ? `${process.cwd()}/frontend/dist`
    : `${process.cwd()}/frontend/`;

const app = express();

const appDomain = "https://" + shopify.api.config.hostName;
let shopName = "shop url here";
const customLocationId = "target inventory location number here";

let orderId = "";

let fulfillmentData = {
  id: "",
  line_items: "",
};


app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(),
  shopify.redirectToShopifyOrAppRoot()
);
app.post(
  shopify.config.webhooks.path,
  shopify.processWebhooks({
    webhookHandlers: {
      CUSTOMERS_DATA_REQUEST: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          const payload = JSON.parse(body);
        },
      },

      CUSTOMERS_REDACT: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          const payload = JSON.parse(body);
        },
      },

      SHOP_REDACT: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback: async (topic, shop, body, webhookId) => {
          const payload = JSON.parse(body);
        },
      },

      ORDERS_CREATE: {
        deliveryMethod: DeliveryMethod.Http,
        callbackUrl: "/api/webhooks",
        callback: async (topic, shop, body, webhookId) => {

          const initiAlOrderData = JSON.parse(body);
          orderId = initiAlOrderData.id;

          setTimeout(() => {
            getUpdatedOrderData().then((dt) => {
                 if (
                  dt.orderData.note !== null &&
                  dt.orderData.note
                    .toLowerCase()
                    .replaceAll(" ", "")
                    .includes("bwporder")
                ) {
                  getFulfillmentData().then(() => {
                    canFulfillmentMove();
                  });
                }

            })
          }, 30000);
        },
      },
    },
  })
);

app.get("/app/get-ff-data", async (req, res) => {
  let sessionId = await shopify.api.session.getOfflineId(shopName);
  let session = await shopify.config.sessionStorage.loadSession(sessionId);
  let dt = await shopify.api.rest.FulfillmentOrder.all({
    session,
    order_id: orderId,
  });
  return res.json({ succes: true, dt });
});

async function getFulfillmentData() {
  const response = await fetch(`${appDomain}/app/get-ff-data`, {
    method: "GET",
  });
  const fulfillment = await response.json();
  fulfillmentData.id = fulfillment.dt.data[0].id;
  fulfillmentData.line_items = fulfillment.dt.data[0].line_items;
}


async function getUpdatedOrderData() { 
  const response = await fetch(`${appDomain}/app/get-order-data`, {
    method: "GET",
  });

  const orderData = await response.json();
  return orderData;
}

app.get("/app/get-order-data", async (req, res) => {
  let sessionId = await shopify.api.session.getOfflineId(shopName);
  let session = await shopify.config.sessionStorage.loadSession(sessionId);

  let orderData = await shopify.api.rest.Order.find({
    session,
    id: orderId,
    fields:"note",
  });
  
  return res.json({ succes: true, orderData });
});


app.get("/app/get-ff-move", async (req, res) => {
  let sessionId = await shopify.api.session.getOfflineId(shopName);
  let session = await shopify.config.sessionStorage.loadSession(sessionId);
  let locationData = await shopify.api.rest.LocationsForMove.all({
    session,
    fulfillment_order_id: fulfillmentData.id,
  });
  return res.json({ succes: true, locationData });
});

async function canFulfillmentMove() {
  const response = await fetch(`${appDomain}/app/get-ff-move`, {
    method: "GET",
  });
  const dt = await response.json();
  dt.locationData.data.map((item) => {
    if (item.location.id == customLocationId) {
      if (item.movable) {
        changeFulfillmentLocation();
      }
    }
  });
}

app.post("/app/set-ff-location", async (req, res) => {
  let sessionId = await shopify.api.session.getOfflineId(shopName);
  let session = await shopify.config.sessionStorage.loadSession(sessionId);
  const fulfillment_order = new shopify.api.rest.FulfillmentOrder({ session });
  fulfillment_order.id = Number(fulfillmentData.id);
  await fulfillment_order.move({
    body: {
      fulfillment_order: {
        new_location_id: customLocationId,
        fulfillment_order_line_items: fulfillmentData.line_items,
      },
    },
  });
  return res.json({ succes: true, fulfillment_order });
});

async function changeFulfillmentLocation() {
  const response = await fetch(`${appDomain}/app/set-ff-location`, {
    method: "POST",
  });
}

app.use("/api/*", shopify.validateAuthenticatedSession());

app.use(express.json());

app.use(shopify.cspHeaders());
app.use(serveStatic(STATIC_PATH, { index: false }));

app.use("/*", shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set("Content-Type", "text/html")
    .send(readFileSync(join(STATIC_PATH, "index.html")));
});

app.listen(PORT);
