// Chỉ import core thuần: không import Prisma runtime, Redis, services/index hoặc .env.
require("ts-node/register/transpile-only");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serialize, deserialize } = require("node:v8");
const {
  completeRepurchase,
  completeRepurchasesForDate,
  withRepurchaseStock,
} = require("../src/services/commissionRepurchase.core");

function fixture(ruleType = "positive", amount = 3500000) {
  let state = {
    requests: [
      {
        id: 1n,
        customerId: 88,
        ruleType,
        amount: BigInt(amount),
        status: "pending",
        calculationDate: "2026-10-09",
        attempts: 0,
      },
    ],
    orders: [],
    ships: [],
    items: [],
    purchased: 0,
  };
  let held = 0,
    failure = "",
    tail = Promise.resolve();
  const products = [
    {
      id: 100,
      itemId: 200,
      productTypeId: 300,
      paymentCash: amount,
      payment: "cash",
      paymentPoint: 0,
      isActive: true,
      isDelete: false,
      name: "Sản phẩm tái mua",
      images: ["image"],
      storeId: 400,
      weight: 1,
    },
  ];
  const tx = {
    $queryRaw: async () => [],
    commissionRepurchase: {
      findUniqueOrThrow: async ({ where }) =>
        state.requests.find((r) => r.id === where.id),
      findMany: async ({ where }) =>
        state.requests.filter(
          (r) =>
            r.calculationDate === where.calculationDate &&
            where.status.in.includes(r.status),
        ),
      update: async ({ where, data }) => {
        const r = state.requests.find((r) => r.id === where.id);
        Object.assign(r, data, { attempts: r.attempts + 1 });
        return r;
      },
    },
    product: {
      findMany: async ({ where }) =>
        products
          .filter((p) => Object.entries(where).every(([k, v]) => p[k] === v))
          .slice(0, 2),
    },
    customer: {
      findUnique: async () => ({
        id: 88,
        name: "Khách test",
        phone: "0967757881",
      }),
    },
    productType: {
      findUnique: async () => ({ isActive: true, isApprove: true }),
    },
    store: {
      findUnique: async () => ({ id: 400, name: "Store", state: true }),
    },
    item: {
      update: async () => {
        state.purchased++;
      },
    },
    order: {
      create: async ({ data }) => {
        const row = { id: state.orders.length + 1, ...data };
        state.orders.push(row);
        return row;
      },
    },
    ordership: {
      create: async ({ data }) => {
        if (failure === "ship") throw Error("ship failed");
        const row = { id: state.ships.length + 1, ...data };
        state.ships.push(row);
        return row;
      },
      update: async ({ where, data }) =>
        Object.assign(
          state.ships.find((s) => s.id === where.id),
          data,
        ),
    },
    orderitem: {
      create: async ({ data }) => {
        const row = { id: state.items.length + 1, createdAt: 1n, ...data };
        state.items.push(row);
        return row;
      },
    },
  };
  // Mô phỏng transaction rollback và khóa để kiểm tra nhiều worker gọi lặp cùng yêu cầu.
  async function transaction(fn) {
    const previous = tail;
    let release;
    tail = new Promise((r) => {
      release = r;
    });
    await previous;
    const before = deserialize(serialize(state));
    try {
      return await fn(tx);
    } catch (e) {
      state = before;
      throw e;
    } finally {
      release();
    }
  }
  const stock = {
    hold: async () => {
      if (failure === "stock") throw Error("out of stock");
      held++;
    },
    release: async (items) => {
      held -= items.length;
    },
  };
  const run = (id = 1n) =>
    withRepurchaseStock(stock, (reserve) =>
      transaction((t) => completeRepurchase(t, id, reserve)),
    );
  return {
    get state() {
      return state;
    },
    get held() {
      return held;
    },
    products,
    tx,
    run,
    fail: (value) => {
      failure = value;
    },
    batch: () =>
      withRepurchaseStock(stock, (reserve) =>
        transaction((t) =>
          completeRepurchasesForDate(t, "2026-10-09", reserve),
        ),
      ),
  };
}

for (const [rule, amount] of [
  ["positive", 3500000],
  ["restructure", 30000000],
]) {
  test(`${rule}: tạo đủ order/ordership/orderitem completed, không thu tiền lại`, async () => {
    const f = fixture(rule, amount);
    await f.run();
    assert.equal(f.state.orders.length, 1);
    assert.equal(f.state.ships.length, 1);
    assert.equal(f.state.items.length, 1);
    const o = f.state.orders[0];
    assert.equal(o.totalMoney, amount);
    assert.equal(o.moneyPaid, 0);
    assert.equal(o.consumptionPointUsed, 0n);
    assert.equal(o.sourceOrder, `commission_${rule}_repurchase`);
    assert.equal(o.paymentStatus, "completed");
    assert.equal(f.state.ships[0].status, "completed");
    assert.equal(f.state.items[0].status, "completed");
    assert.equal(f.state.requests[0].orderId, o.id);
    assert.equal(f.state.requests[0].status, "completed");
    assert.equal(f.state.purchased, 1);
    assert.equal(f.held, 1);
  });
}
test("gọi lặp/đồng thời không tạo đơn hay trừ tồn hai lần", async () => {
  const f = fixture();
  await Promise.all([f.run(), f.run(), f.run()]);
  assert.equal(f.state.orders.length, 1);
  assert.equal(f.held, 1);
  assert.equal(f.state.purchased, 1);
});
test("không có sản phẩm đúng giá: không tạo đơn", async () => {
  const f = fixture();
  f.products[0].paymentCash = 100;
  await assert.rejects(f.run(), /Không có sản phẩm/);
  assert.equal(f.state.orders.length, 0);
  assert.equal(f.held, 0);
});
test("trùng giá: không tự chọn sản phẩm", async () => {
  const f = fixture();
  f.products.push({ ...f.products[0], id: 101 });
  await assert.rejects(f.run(), /nhiều sản phẩm/);
  assert.equal(f.state.orders.length, 0);
});
test("sản phẩm ngừng bán: không tạo đơn", async () => {
  const f = fixture();
  f.products[0].isActive = false;
  await assert.rejects(f.run(), /Không có sản phẩm/);
});
test("hết hàng: giữ yêu cầu, không có đơn", async () => {
  const f = fixture();
  f.fail("stock");
  await assert.rejects(f.run(), /out of stock/);
  assert.equal(f.state.requests[0].status, "pending");
  assert.equal(f.state.orders.length, 0);
});
test("lỗi sau tạo order: rollback tất cả và hoàn giữ hàng; retry thành công", async () => {
  const f = fixture();
  f.fail("ship");
  await assert.rejects(f.run(), /ship failed/);
  assert.equal(f.state.orders.length, 0);
  assert.equal(f.state.purchased, 0);
  assert.equal(f.held, 0);
  f.fail("");
  await f.run();
  assert.equal(f.state.orders.length, 1);
  assert.equal(f.held, 1);
});
test("nhiều lần tái mua tạo đúng số đơn và batch lặp không thêm đơn", async () => {
  const f = fixture();
  f.state.requests.push({ ...f.state.requests[0], id: 2n });
  await f.batch();
  await f.batch();
  assert.equal(f.state.orders.length, 2);
  assert.equal(f.held, 2);
});
test("yêu cầu failed được thử lại, yêu cầu có orderId bất thường không tạo trùng", async () => {
  const f = fixture();
  f.state.requests[0].status = "failed";
  await f.run();
  assert.equal(f.state.requests[0].status, "completed");
  f.state.requests[0].status = "pending";
  await assert.rejects(f.run(), /đã có đơn/);
  assert.equal(f.state.orders.length, 1);
});
test("giá trị âm và loại không hợp lệ không được tạo đơn", async () => {
  await assert.rejects(fixture("positive", -1).run(), /Giá trị/);
  await assert.rejects(fixture("other").run(), /Loại/);
});
test("lỗi yêu cầu thứ hai rollback cả batch, kể cả tồn của yêu cầu đầu", async () => {
  const f = fixture();
  f.state.requests.push({ ...f.state.requests[0], id: 2n, amount: 30000000n });
  await assert.rejects(f.batch(), /Không có sản phẩm/);
  assert.equal(f.state.orders.length, 0);
  assert.equal(f.state.requests[0].status, "pending");
  assert.equal(f.state.purchased, 0);
  assert.equal(f.held, 0);
});
test("sản phẩm chưa được duyệt không được tự mua", async () => {
  const f = fixture();
  f.tx.productType.findUnique = async () => ({
    isActive: true,
    isApprove: false,
  });
  await assert.rejects(f.run(), /không hợp lệ/);
  assert.equal(f.held, 0);
});
test("test không nạp các kết nối thật", () => {
  const loaded = Object.keys(require.cache);
  assert.equal(
    loaded.some((p) => /src\/utils\/(prisma|redis)\.(ts|js)$/.test(p)),
    false,
  );
  assert.equal(
    loaded.some((p) => p.endsWith("/src/services/index.ts")),
    false,
  );
});
