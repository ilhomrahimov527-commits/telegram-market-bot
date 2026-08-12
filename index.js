const { Bot, InlineKeyboard, Keyboard } = require("grammy");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const http = require("http");

require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "8491952252";
const PORT = process.env.PORT || 3000;

// 💳 РЕКВИЗИТЫ ДЛЯ ОПЛАТЫ (Банк Эсхата)
const ESHATA_WALLET = process.env.ESHATA_WALLET || "+992035822424";
const ESHATA_CARD_NAME = process.env.ESHATA_CARD_NAME || "Azam Р.";

const bot = new Bot(BOT_TOKEN);
let db;

// 🗄 ИНИЦИАЛИЗАЦИЯ ОБНОВЛЕННОЙ БАЗЫ ДАННЫХ
async function initDb() {
  db = await open({
    filename: "./database.db",
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = ON;');

  // 1. Таблица товаров (с остатком stock и флагом активности)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      target TEXT,
      category TEXT,
      brand TEXT,
      price INTEGER,
      image TEXT,
      sizes TEXT,
      stock INTEGER DEFAULT 10,
      is_active INTEGER DEFAULT 1
    );
  `);

  // 2. Таблица корзины в БД (сессии больше не теряются при перезапуске)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      size TEXT,
      quantity INTEGER DEFAULT 1,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
    );
  `);

  // 3. Общая таблица заказов
  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      phone TEXT,
      address TEXT,
      total_price INTEGER,
      payment_method TEXT DEFAULT 'cash',
      receipt_photo TEXT,
      status TEXT DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Позиции заказов для аналитики
  await db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      size TEXT,
      price INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products (id)
    );
  `);

  const count = await db.get("SELECT COUNT(*) as count FROM products");
  if (count.count === 0) {
    await seedInitialProducts();
  }

  console.log("🗄 База данных SQLite с новой архитектурой подключена!");
}

async function seedInitialProducts() {
  const initialProducts = [
    { name: "Кроссовки Nike Air Force 1 '07", target: "men", category: "shoes", brand: "Nike", price: 8990, image: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600", sizes: "40,41,42,43,44", stock: 10 },
    { name: "Кроссовки Adidas Ultraboost Light", target: "men", category: "shoes", brand: "Adidas", price: 11490, image: "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=600", sizes: "41,42,43,45", stock: 15 },
    { name: "Кроссовки Nike Air Max Blossom", target: "women", category: "shoes", brand: "Nike", price: 8490, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600", sizes: "36,37,38,39", stock: 8 },
    { name: "Футболка Nike Sportswear Tee Black", target: "men", category: "clothes", brand: "Nike", price: 2990, image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600", sizes: "S,M,L,XL", stock: 20 },
    { name: "Футболка Oversize Adidas Originals", target: "women", category: "clothes", brand: "Adidas", price: 3490, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=600", sizes: "XS,S,M,L", stock: 12 },
    { name: "Детские кроссовки Nike Dynamo GO", target: "kids", category: "kids_shoes", brand: "Nike Kids", price: 4200, image: "https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=600", sizes: "28,29,30,31,32", stock: 5 },
    { name: "Детский костюм H&M Cotton Set", target: "kids", category: "kids_clothes", brand: "H&M", price: 2500, image: "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600", sizes: "110,116,122", stock: 7 },
    { name: "Гарри Поттер и Философский камень", target: "kids", category: "books", brand: "Эксмо", price: 1200, image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600", sizes: "nosize", stock: 30 },
    { name: "Конструктор LEGO City Грузовик", target: "kids", category: "toys", brand: "LEGO", price: 3200, image: "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600", sizes: "nosize", stock: 10 },
    { name: "Набор шоколадных конфет Ferrero", target: "kids", category: "food", brand: "Ferrero", price: 950, image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=600", sizes: "nosize", stock: 25 },
    { name: "Детский гель Mustela 500мл", target: "kids", category: "cleaning", brand: "Mustela", price: 1650, image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", sizes: "nosize", stock: 14 }
  ];

  for (const p of initialProducts) {
    await db.run(
      `INSERT INTO products (name, target, category, brand, price, image, sizes, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [p.name, p.target, p.category, p.brand, p.price, p.image, p.sizes, p.stock]
    );
  }
}

// Оперативное состояние шагов
const userStates = {};

function getUserState(userId) {
  const idStr = userId.toString();
  if (!userStates[idStr]) {
    userStates[idStr] = { step: "idle", newProduct: {}, currentTarget: "men" };
  }
  return userStates[idStr];
}

// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КОРЗИНЫ (БД)
async function getCart(userId) {
  return await db.all(
    `SELECT c.id AS cart_id, c.product_id, c.size, c.quantity, p.name, p.price, p.stock 
     FROM cart c 
     JOIN products p ON c.product_id = p.id 
     WHERE c.user_id = ?`,
    [userId]
  );
}

async function addToCartDb(userId, productId, size) {
  const existing = await db.get(
    "SELECT * FROM cart WHERE user_id = ? AND product_id = ? AND size = ?",
    [userId, productId, size]
  );
  if (existing) {
    await db.run("UPDATE cart SET quantity = quantity + 1 WHERE id = ?", [existing.id]);
  } else {
    await db.run(
      "INSERT INTO cart (user_id, product_id, size, quantity) VALUES (?, ?, ?, 1)",
      [userId, productId, size]
    );
  }
}

async function clearCartDb(userId) {
  await db.run("DELETE FROM cart WHERE user_id = ?", [userId]);
}

// 🏁 1. ГЛАВНОЕ МЕНЮ И СТАРТ
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;
  userStates[userId.toString()] = { step: "idle", newProduct: {}, currentTarget: "men" };

  const keyboard = new InlineKeyboard()
    .text("🛍 Каталог товаров", "open_catalog")
    .row()
    .text("📜 Мои заказы", "my_orders")
    .text("🛒 Корзина", "view_cart")
    .row()
    .text("❓ Частые вопросы (FAQ)", "show_faq")
    .text("💬 Менеджер", "ask_manager");

  if (userId.toString() === ADMIN_CHAT_ID.toString()) {
    keyboard.row().text("👑 Админ-панель", "admin_panel");
  }

  await ctx.reply("<b>Добро пожаловать в наш онлайн-магазин! 🛍</b>\n\nВыберите действие в меню ниже:", {
    parse_mode: "HTML",
    reply_markup: keyboard
  });
});

// 👑 АДМИН-ПАНЕЛЬ
bot.command("admin", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await showAdminMenu(ctx);
});

bot.callbackQuery("admin_panel", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await showAdminMenu(ctx);
});

async function showAdminMenu(ctx) {
  const keyboard = new InlineKeyboard()
    .text("➕ Добавить товар", "start_add_product")
    .row()
    .text("❌ Удалить товар", "start_del_product")
    .row()
    .text("📜 История всех заказов", "admin_orders")
    .row()
    .text("⬅️ В главное меню", "back_to_main");

  await ctx.reply("👑 <b>Панель администратора:</b>\nВыберите необходимое действие:", {
    parse_mode: "HTML",
    reply_markup: keyboard
  });
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
}

// 📜 ИСТОРИЯ ЗАКАЗОВ ДЛЯ ПОЛЬЗОВАТЕЛЯ
bot.callbackQuery("my_orders", async (ctx) => {
  const userId = ctx.from.id;
  const orders = await db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10", [userId]);

  if (orders.length === 0) {
    return ctx.answerCallbackQuery({ text: "У вас пока нет заказов!", show_alert: true });
  }

  let text = "<b>📜 ВАШИ ПОСЛЕДНИЕ ЗАКАЗЫ:</b>\n\n";
  for (const o of orders) {
    const items = await db.all(
      `SELECT oi.*, p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`,
      [o.id]
    );
    text += `📦 <b>Заказ №${o.id}</b> | ${o.total_price} руб.\n`;
    text += `Оплата: ${o.payment_method}\n`;
    text += `Статус: ${o.status} | Дата: ${o.created_at}\nСостав:\n`;
    items.forEach((it) => {
      text += `• ${it.name} (${it.size}) x${it.quantity} — ${it.price * it.quantity} руб.\n`;
    });
    text += `--------------------\n`;
  }

  const keyboard = new InlineKeyboard().text("⬅️ Назад", "back_to_main");
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

// 📜 ИСТОРИЯ ВСЕХ ЗАКАЗОВ ДЛЯ АДМИНА
bot.callbackQuery("admin_orders", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;

  const orders = await db.all("SELECT * FROM orders ORDER BY id DESC LIMIT 10");
  if (orders.length === 0) {
    return ctx.answerCallbackQuery({ text: "Заказов в базе нет!", show_alert: true });
  }

  let text = "<b>📜 ПОСЛЕДНИЕ 10 ЗАКАЗОВ (АДМИН):</b>\n\n";
  for (const o of orders) {
    const items = await db.all(
      `SELECT oi.*, p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`,
      [o.id]
    );
    text += `🚨 <b>Заказ №${o.id}</b> (${o.username})\n`;
    text += `Тел: ${o.phone} | Сумма: ${o.total_price} | Способ: ${o.payment_method}\n`;
    text += `Статус: ${o.status}\nСостав:\n`;
    items.forEach((it) => {
      text += `• ${it.name} (${it.size}) x${it.quantity} — ${it.price * it.quantity} руб.\n`;
    });
    text += `--------------------\n`;
  }

  const keyboard = new InlineKeyboard().text("⬅️ В админку", "admin_panel");
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

// ❓ FAQ И СВЯЗЬ С МЕНЕДЖЕРОМ
bot.callbackQuery("show_faq", async (ctx) => {
  const faqText =
    `<b>❓ ЧАСТО ЗАДАВАЕМЫЕ ВОПРОСЫ</b>\n\n` +
    `<b>🚚 Доставка:</b> Доставка осуществляется от 2 до 5 дней.\n\n` +
    `<b>💳 Оплата:</b> Через Банк Эсхата или при получении.\n\n` +
    `<b>🔄 Возврат:</b> В течение 14 дней.`;

  const keyboard = new InlineKeyboard()
    .text("💬 Задать вопрос менеджеру", "ask_manager")
    .row()
    .text("⬅️ Главное меню", "back_to_main");

  await ctx.reply(faqText, { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ask_manager", async (ctx) => {
  const state = getUserState(ctx.from.id);
  state.step = "waiting_question";
  await ctx.reply("💬 <b>Напишите ваш вопрос для менеджера.</b>\nМы ответим вам прямо в этом чате!", { parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("back_to_main", async (ctx) => {
  const userId = ctx.from.id;
  const keyboard = new InlineKeyboard()
    .text("🛍 Каталог товаров", "open_catalog")
    .row()
    .text("📜 Мои заказы", "my_orders")
    .text("🛒 Корзина", "view_cart")
    .row()
    .text("❓ Частые вопросы (FAQ)", "show_faq")
    .text("💬 Менеджер", "ask_manager");

  if (userId.toString() === ADMIN_CHAT_ID.toString()) {
    keyboard.row().text("👑 Админ-панель", "admin_panel");
  }

  await ctx.reply("<b>Главное меню:</b>", { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

// 🎯 КАТАЛОГ
bot.callbackQuery("open_catalog", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("👨 Для Мужчин", "target_men")
    .row()
    .text("👩 Для Женщин", "target_women")
    .row()
    .text("👶 Для Детей", "target_kids");

  await ctx.reply("<b>Для кого вы хотите подобрать товары?</b>", { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^target_(men|women|kids)$/, async (ctx) => {
  const target = ctx.match[1];
  const state = getUserState(ctx.from.id);
  state.currentTarget = target;

  const keyboard = new InlineKeyboard();

  if (target === "kids") {
    keyboard
      .text("👟 Детская обувь", "cat_kids_shoes")
      .text("👕 Детская одежда", "cat_kids_clothes")
      .row()
      .text("📚 Книги", "cat_books")
      .text("🧸 Игрушки", "cat_toys")
      .row()
      .text("🍏 Еда и продукты", "cat_food")
      .text("🧴 Моющие средства", "cat_cleaning");
  } else {
    keyboard.text("👟 Кроссовки", "cat_shoes").row().text("👕 Футболки и Одежда", "cat_clothes");
  }

  await ctx.reply("<b>Выберите категорию:</b>", { parse_mode: "HTML", reply_markup: keyboard });
  await ctx.answerCallbackQuery();
});

// 📦 ПАГИНАЦИЯ И ПРОСМОТР КАТАЛОГА
bot.callbackQuery(/^cat_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  const state = getUserState(ctx.from.id);
  state.currentCategory = category;
  await showProductPage(ctx, category, 0);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^page_(.+)_(\d+)$/, async (ctx) => {
  const category = ctx.match[1];
  const pageIndex = parseInt(ctx.match[2]);
  await showProductPage(ctx, category, pageIndex);
  await ctx.answerCallbackQuery();
});

async function showProductPage(ctx, category, pageIndex) {
  const state = getUserState(ctx.from.id);
  const target = state.currentTarget || "men";

  // Пагинация на базе SQL и проверка активности/остатков
  const products = await db.all(
    "SELECT * FROM products WHERE category = ? AND (target = ? OR target = 'men') AND is_active = 1",
    [category, target]
  );

  if (!products || products.length === 0) {
    return ctx.answerCallbackQuery({ text: "⚠️ В этой категории пока нет товаров!", show_alert: true });
  }

  if (pageIndex < 0 || pageIndex >= products.length) pageIndex = 0;
  const item = products[pageIndex];

  const keyboard = new InlineKeyboard();

  if (item.stock <= 0) {
    keyboard.text("❌ Нет в наличии", "ignore");
  } else if (item.sizes && item.sizes !== "nosize") {
    keyboard.text("📏 Выбрать размер", `show_sizes_${item.id}`);
  } else {
    keyboard.text(`🛒 В корзину (${item.price} руб.)`, `add_${item.id}_nosize`);
  }
  keyboard.row();

  const prevPage = pageIndex - 1;
  const nextPage = pageIndex + 1;

  if (prevPage >= 0) keyboard.text("⬅️ Назад", `page_${category}_${prevPage}`);
  keyboard.text(`${pageIndex + 1} / ${products.length}`, "ignore");
  if (nextPage < products.length) keyboard.text("Вперед ➡️", `page_${category}_${nextPage}`);

  const caption = `<b>${item.name}</b>\nБренд: ${item.brand}\nВ наличии: ${item.stock} шт.\n\n💰 <b>Цена:</b> ${item.price} руб.`;

  try {
    await ctx.replyWithPhoto(item.image, {
      caption: caption,
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  } catch (e) {
    await ctx.reply(`${caption}\n\n[Картинка недоступна]`, {
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  }
}

// 📏 ПОКАЗ И ВЫБОР РАЗМЕРОВ
bot.callbackQuery(/^show_sizes_(\d+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);

  if (!product || !product.sizes) {
    return ctx.answerCallbackQuery({ text: "Размеры недоступны", show_alert: true });
  }

  const sizesArr = product.sizes.split(",").map((s) => s.trim());
  const keyboard = new InlineKeyboard();

  sizesArr.forEach((sz, idx) => {
    keyboard.text(`Размер: ${sz}`, `add_${productId}_${sz}`);
    if ((idx + 1) % 2 === 0) keyboard.row();
  });

  await ctx.reply(`Выберите размер для <b>${product.name}</b>:`, {
    parse_mode: "HTML",
    reply_markup: keyboard
  });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("ignore", (ctx) => ctx.answerCallbackQuery());

// 🛒 ДОБАВЛЕНИЕ В КОРЗИНУ (БД)
bot.callbackQuery(/^add_(\d+)_(.+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const selectedSize = ctx.match[2];
  const userId = ctx.from.id;

  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);
  if (!product || product.stock <= 0) {
    return ctx.answerCallbackQuery({ text: "Товара нет в наличии!", show_alert: true });
  }

  const chosenSizeLabel = selectedSize !== "nosize" ? selectedSize : "Единый";
  await addToCartDb(userId, productId, chosenSizeLabel);

  const navKeyboard = new InlineKeyboard()
    .text("🛒 Перейти в корзину", "view_cart")
    .row()
    .text("🛍 Продолжить покупки", "open_catalog");

  await ctx.answerCallbackQuery({ text: `✅ Добавлено!` });
  await ctx.reply(
    `✅ <b>${product.name}</b> (${chosenSizeLabel}) добавлен в корзину!`,
    { parse_mode: "HTML", reply_markup: navKeyboard }
  );
});

// 🛒 ПРОСМОТР И УПРАВЛЕНИЕ КОРЗИНОЙ
bot.callbackQuery("view_cart", async (ctx) => {
  await renderCart(ctx);
  if (ctx.callbackQuery) await ctx.answerCallbackQuery();
});

async function renderCart(ctx) {
  const userId = ctx.from.id;
  const cartItems = await getCart(userId);

  if (cartItems.length === 0) {
    const emptyKb = new InlineKeyboard().text("🛍 В каталог", "open_catalog");
    return ctx.reply("<b>Ваша корзина пуста!</b>", { parse_mode: "HTML", reply_markup: emptyKb });
  }

  let total = 0;
  let text = "<b>🛒 ВАША КОРЗИНА:</b>\n\n";
  const keyboard = new InlineKeyboard();

  cartItems.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    text += `${index + 1}. <b>${item.name}</b> (${item.size})\n`;
    text += `   ${item.quantity} шт. x ${item.price} = <b>${itemTotal} руб.</b>\n\n`;

    keyboard.text(`➖`, `cart_dec_${item.cart_id}`).text(`${item.quantity} шт`, "ignore").text(`➕`, `cart_inc_${item.cart_id}`).text(`❌`, `cart_del_${item.cart_id}`).row();
  });

  text += `💳 <b>Итого к оплате:</b> ${total} руб.`;

  keyboard
    .text("✅ Оформить заказ", "start_checkout")
    .row()
    .text("🗑 Очистить корзину", "clear_cart")
    .text("⬅️ В главное меню", "back_to_main");

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
}

bot.callbackQuery(/^cart_inc_(\d+)$/, async (ctx) => {
  const cartId = parseInt(ctx.match[1]);
  await db.run("UPDATE cart SET quantity = quantity + 1 WHERE id = ?", [cartId]);
  await renderCart(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^cart_dec_(\d+)$/, async (ctx) => {
  const cartId = parseInt(ctx.match[1]);
  const item = await db.get("SELECT * FROM cart WHERE id = ?", [cartId]);
  if (item) {
    if (item.quantity > 1) {
      await db.run("UPDATE cart SET quantity = quantity - 1 WHERE id = ?", [cartId]);
    } else {
      await db.run("DELETE FROM cart WHERE id = ?", [cartId]);
    }
  }
  await renderCart(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^cart_del_(\d+)$/, async (ctx) => {
  const cartId = parseInt(ctx.match[1]);
  await db.run("DELETE FROM cart WHERE id = ?", [cartId]);
  await renderCart(ctx);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("clear_cart", async (ctx) => {
  await clearCartDb(ctx.from.id);
  await ctx.answerCallbackQuery({ text: "Корзина очищена!" });
  await renderCart(ctx);
});

// 💳 ОФОРМЛЕНИЕ ЗАКАЗА
bot.callbackQuery("start_checkout", async (ctx) => {
  const userId = ctx.from.id;
  const cartItems = await getCart(userId);

  if (cartItems.length === 0) {
    return ctx.answerCallbackQuery({ text: "Ваша корзина пуста!", show_alert: true });
  }

  const state = getUserState(userId);
  state.step = "waiting_phone";

  const phoneKeyboard = new Keyboard()
    .requestContact("📱 Поделиться номером телефона")
    .resized()
    .oneTime();

  await ctx.reply("Для оформления заказа поделитесь вашим номером телефона с помощью кнопки ниже или напишите его вручную:", { reply_markup: phoneKeyboard });
  await ctx.answerCallbackQuery();
});

// Прием контакта через кнопку
bot.on(":contact", async (ctx) => {
  const state = getUserState(ctx.from.id);
  if (state.step === "waiting_phone") {
    state.phone = ctx.message.contact.phone_number;
    state.step = "waiting_address";

    await ctx.reply("Спасибо! Теперь введите ваш адрес доставки (город, улица, дом/квартира):", {
      reply_markup: { remove_keyboard: true }
    });
  }
});

// ➕ ДОБАВЛЕНИЕ И УДАЛЕНИЕ ТОВАРОВ (АДМИН)
bot.callbackQuery("start_add_product", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const state = getUserState(ctx.from.id);
  state.step = "add_prod_name";
  state.newProduct = {};
  await ctx.reply("➕ <b>Добавление товара (Шаг 1/7):</b> Введите название товара:", { parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("start_del_product", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const allProducts = await db.all("SELECT * FROM products WHERE is_active = 1 ORDER BY id DESC");

  if (allProducts.length === 0) {
    await ctx.reply("В базе пока нет активных товаров.");
    return ctx.answerCallbackQuery();
  }

  for (const item of allProducts) {
    const keyboard = new InlineKeyboard().text(`❌ Удалить (${item.name})`, `del_prod_${item.id}`);
    await ctx.replyWithPhoto(item.image, { caption: `<b>[ID: ${item.id}] ${item.name}</b>`, parse_mode: "HTML", reply_markup: keyboard });
  }
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^del_prod_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await db.run("UPDATE products SET is_active = 0 WHERE id = ?", [ctx.match[1]]);
  await ctx.answerCallbackQuery({ text: "✅ Удалено!" });
  await ctx.reply("❌ <b>ТОВАР УДАЛЕН ИЗ КАТАЛОГА</b>", { parse_mode: "HTML" });
});

bot.callbackQuery(/^set_target_(men|women|kids)$/, async (ctx) => {
  const state = getUserState(ctx.from.id);
  state.newProduct.target = ctx.match[1];

  const kb = new InlineKeyboard();
  if (state.newProduct.target === "kids") {
    kb.text("👟 Обувь", "set_cat_kids_shoes").text("👕 Одежда", "set_cat_kids_clothes")
      .row()
      .text("📚 Книги", "set_cat_books").text("🧸 Игрушки", "set_cat_toys")
      .row()
      .text("🍏 Еда", "set_cat_food").text("🧴 Моющие средства", "set_cat_cleaning");
  } else {
    kb.text("👟 Кроссовки", "set_cat_shoes").row().text("👕 Одежда", "set_cat_clothes");
  }
  await ctx.reply("Шаг 3/7: Выберите категорию:", { reply_markup: kb });
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^set_cat_(.+)$/, async (ctx) => {
  const state = getUserState(ctx.from.id);
  state.newProduct.category = ctx.match[1];
  state.step = "add_prod_brand";
  await ctx.reply("Шаг 4/7: Введите бренд товара:");
  await ctx.answerCallbackQuery();
});

// 💳 ВЫБОР СПОСОБА ОПЛАТЫ И ЗАПИСЬ В БД
bot.callbackQuery(/^pay_(eshata|cash)$/, async (ctx) => {
  const paymentMethod = ctx.match[1];
  const userId = ctx.from.id;
  const state = getUserState(userId);

  const cartItems = await getCart(userId);
  let total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (paymentMethod === "eshata") {
    state.step = "waiting_receipt";
    const text =
      `💳 <b>ОПЛАТА ЧЕРЕЗ БАНК ЭСХАТА</b>\n\n` +
      `Пожалуйста, переведите <b>${total} руб.</b> на кошелёк/карту:\n` +
      `📱 <b>Номер:</b> <code>${ESHATA_WALLET}</code>\n` +
      `👤 <b>Получатель:</b> ${ESHATA_CARD_NAME}\n\n` +
      `📸 <b>После оплаты отправьте скриншот чека в этот чат!</b>`;

    await ctx.reply(text, { parse_mode: "HTML" });
  } else {
    await createOrderInDb(userId, ctx, "💵 Наличными при получении", null);
  }
  await ctx.answerCallbackQuery();
});

async function createOrderInDb(userId, ctx, paymentLabel, receiptPhoto) {
  const state = getUserState(userId);
  const cartItems = await getCart(userId);
  const username = ctx.from.username ? `@${ctx.from.username}` : "Без username";

  if (cartItems.length === 0) return;

  let total = 0;
  let orderDetails = "";

  cartItems.forEach((item, i) => {
    const sum = item.price * item.quantity;
    orderDetails += `${i + 1}. ${item.name} (${item.size}) x${item.quantity} — ${sum} руб.\n`;
    total += sum;
  });

  // Запись основного заказа
  const result = await db.run(
    `INSERT INTO orders (user_id, username, phone, address, total_price, payment_method, receipt_photo, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
    [userId, username, state.phone, state.address, total, paymentLabel, receiptPhoto]
  );
  const orderId = result.lastID;

  // Запись единиц заказа в order_items и списание stock
  for (const item of cartItems) {
    await db.run(
      `INSERT INTO order_items (order_id, product_id, quantity, size, price) VALUES (?, ?, ?, ?, ?)`,
      [orderId, item.product_id, item.quantity, item.size, item.price]
    );

    await db.run(
      `UPDATE products SET stock = stock - ? WHERE id = ?`,
      [item.quantity, item.product_id]
    );
  }

  // Очистка корзины в базе данных
  await clearCartDb(userId);

  state.step = "idle";

  await notifyAdminAboutOrder(orderId, userId, username, state.phone, state.address, orderDetails, total, paymentLabel, receiptPhoto);

  const userReply = `🎉 <b>Заказ №${orderId} успешно оформлен!</b>\nСпособ оплаты: <b>${paymentLabel}</b>\n\nМенеджер свяжется с вами для подтверждения.`;
  await ctx.reply(userReply, { parse_mode: "HTML" });
}

// 🛠 ОБРАБОТКА ВВОДА И ВАЛИДАЦИЯ
bot.on("message", async (ctx) => {
  if (ctx.message.text && ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const state = getUserState(userId);

  // ВОПРОС МЕНЕДЖЕРУ
  if (state.step === "waiting_question") {
    state.step = "idle";
    const username = ctx.from.username ? `@${ctx.from.username}` : "Без username";
    const replyKb = new InlineKeyboard().text("💬 Ответить клиенту", `reply_user_${userId}`);

    await bot.api.sendMessage(
      ADMIN_CHAT_ID,
      `❓ <b>ВОПРОС ОТ КЛИЕНТА</b> ${username} (ID: <code>${userId}</code>):\n\n"${ctx.message.text}"`,
      { parse_mode: "HTML", reply_markup: replyKb }
    );

    return ctx.reply("✅ Ваш вопрос отправлен менеджеру!");
  }

  // ОТВЕТ МЕНЕДЖЕРА
  if (state.step && state.step.startsWith("replying_to_")) {
    const targetUserId = state.step.replace("replying_to_", "");
    state.step = "idle";

    try {
      await bot.api.sendMessage(targetUserId, `💬 <b>Ответ от менеджера:</b>\n\n${ctx.message.text}`, { parse_mode: "HTML" });
      return ctx.reply("✅ Ответ успешно доставлен клиенту!");
    } catch (e) {
      return ctx.reply("❌ Не удалось отправить ответ пользователю.");
    }
  }

  // АДМИН: ПОШАГОВОЕ ДОБАВЛЕНИЕ С ВАЛИДАЦИЕЙ
  if (state.step === "add_prod_name") {
    state.newProduct.name = ctx.message.text;
    state.step = "idle";
    const kb = new InlineKeyboard().text("👨 Мужское", "set_target_men").text("👩 Женское", "set_target_women").row().text("👶 Детское", "set_target_kids");
    return ctx.reply("Шаг 2/7: Выберите целевую аудиторию:", { reply_markup: kb });
  }

  if (state.step === "add_prod_brand") {
    state.newProduct.brand = ctx.message.text;
    state.step = "add_prod_price";
    return ctx.reply("Шаг 5/7: Введите цену (только положительное число):");
  }

  if (state.step === "add_prod_price") {
    const price = parseInt(ctx.message.text);
    if (isNaN(price) || price <= 0) {
      return ctx.reply("❌ Неверная цена! Пожалуйста, введите положительное число:");
    }
    state.newProduct.price = price;
    state.step = "add_prod_sizes";
    return ctx.reply("Шаг 6/7: Введите размеры через запятую (например 40,41,42) или nosize:");
  }

  if (state.step === "add_prod_sizes") {
    state.newProduct.sizes = ctx.message.text.trim();
    state.step = "add_prod_image";
    return ctx.reply("Шаг 7/7: Отправьте ссылку на картинку (http...) или фото:");
  }

  if (state.step === "add_prod_image") {
    let imageUrl = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.text;

    if (!ctx.message.photo && (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
      return ctx.reply("❌ Пожалуйста, отправьте корректную ссылку на изображение (начинающуюся с http:// или https://) или фото!");
    }

    state.newProduct.image = imageUrl;

    await db.run(
      `INSERT INTO products (name, target, category, brand, price, image, sizes, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 10, 1)`,
      [state.newProduct.name, state.newProduct.target, state.newProduct.category, state.newProduct.brand, state.newProduct.price, state.newProduct.image, state.newProduct.sizes]
    );

    state.step = "idle";
    return ctx.reply(`🎉 Товар "${state.newProduct.name}" успешно добавлен в базу!`);
  }

  // РУЧНОЙ ВВОД ТЕЛЕФОНА
  if (state.step === "waiting_phone") {
    state.phone = ctx.message.text;
    state.step = "waiting_address";
    return ctx.reply("Спасибо! Теперь введите ваш адрес доставки (город, улица, дом/квартира):", {
      reply_markup: { remove_keyboard: true }
    });
  }

  // АДРЕС И ОПЛАТА
  if (state.step === "waiting_address") {
    state.address = ctx.message.text;
    state.step = "idle";

    const keyboard = new InlineKeyboard()
      .text("💳 Карта / Кошелёк Эсхата", "pay_eshata")
      .row()
      .text("💵 Наличными при получении", "pay_cash");

    await ctx.reply("Выберите способ оплаты:", { reply_markup: keyboard });
    return;
  }

  // ЧЕК
  if (state.step === "waiting_receipt") {
    if (!ctx.message.photo) {
      return ctx.reply("❌ Пожалуйста, отправьте именно фото/скриншот чека из приложения Эсхата!");
    }

    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await createOrderInDb(userId, ctx, "💳 Банк Эсхата (Предоплата)", photoId);
  }
});

// КНОПКА ОТВЕТА КЛИЕНТУ
bot.callbackQuery(/^reply_user_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const targetUserId = ctx.match[1];
  const state = getUserState(ctx.from.id);
  state.step = `replying_to_${targetUserId}`;

  await ctx.reply(`✍️ Введите текст ответа для пользователя (ID: ${targetUserId}):`);
  await ctx.answerCallbackQuery();
});

bot.callbackQuery(/^status_(proc|ship|done|canc)_(\d+)_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const statusMap = { proc: "⚙️ В обработке", ship: "🚚 В доставке", done: "✅ Выполнен", canc: "❌ Отменен" };
  await db.run("UPDATE orders SET status = ? WHERE id = ?", [statusMap[ctx.match[1]], ctx.match[2]]);
  await ctx.answerCallbackQuery({ text: `Статус изменен: ${statusMap[ctx.match[1]]}` });
});

// 💳 ВЫБОР СПОСОБА ОПЛАТЫ И ЗАПИСЬ В БД
bot.callbackQuery(/^pay_(eshata|cash)$/, async (ctx) => {
  const paymentMethod = ctx.match[1];
  const userId = ctx.from.id;
  const state = getUserState(userId);

  const cartItems = await getCart(userId);
  if (!cartItems || cartItems.length === 0) {
    return ctx.answerCallbackQuery({ text: "Ваша корзина пуста!", show_alert: true });
  }

  let total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  if (paymentMethod === "eshata") {
    state.step = "waiting_receipt";
    const text =
      `💳 <b>ОПЛАТА ЧЕРЕЗ БАНК ЭСХАТА</b>\n\n` +
      `Пожалуйста, переведите <b>${total} руб.</b> на кошелёк/карту:\n` +
      `📱 <b>Номер:</b> <code>${ESHATA_WALLET}</code>\n` +
      `👤 <b>Получатель:</b> ${ESHATA_CARD_NAME}\n\n` +
      `📸 <b>После оплаты отправьте скриншот чека в этот чат!</b>`;

    await ctx.reply(text, { parse_mode: "HTML" });
  } else if (paymentMethod === "cash") {
    // Оформление заказа наличными без ожидания чека
    await createOrderInDb(userId, ctx, "💵 Наличными при получении", null);
  }
  
  await ctx.answerCallbackQuery();
});

async function createOrderInDb(userId, ctx, paymentLabel, receiptPhoto) {
  const state = getUserState(userId);
  const cartItems = await getCart(userId);
  const username = ctx.from.username ? `@${ctx.from.username}` : "Без username";

  if (!cartItems || cartItems.length === 0) return;

  let total = 0;
  let orderDetails = "";

  cartItems.forEach((item, i) => {
    const sum = item.price * item.quantity;
    orderDetails += `${i + 1}. ${item.name} (${item.size}) x${item.quantity} — ${sum} руб.\n`;
    total += sum;
  });

  const phone = state.phone || "Не указан";
  const address = state.address || "Не указан";

  try {
    // 1. Запись основного заказа в БД
    const result = await db.run(
      `INSERT INTO orders (user_id, username, phone, address, total_price, payment_method, receipt_photo, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`,
      [userId, username, phone, address, total, paymentLabel, receiptPhoto]
    );
    const orderId = result.lastID;

    // 2. Запись товаров в order_items и уменьшение остатков stock
    for (const item of cartItems) {
      await db.run(
        `INSERT INTO order_items (order_id, product_id, quantity, size, price) VALUES (?, ?, ?, ?, ?)`,
        [orderId, item.product_id, item.quantity, item.size, item.price]
      );

      await db.run(
        `UPDATE products SET stock = stock - ? WHERE id = ?`,
        [item.quantity, item.product_id]
      );
    }

    // 3. Очистка корзины в базе данных
    await clearCartDb(userId);

    // Сброс шага состояния
    state.step = "idle";

    // 4. Отправка карточки заказа администратору
    await notifyAdminAboutOrder(orderId, userId, username, phone, address, orderDetails, total, paymentLabel, receiptPhoto);

    // 5. Подтверждение заказа покупателю
    const userReply = `🎉 <b>Заказ №${orderId} успешно оформлен!</b>\nСпособ оплаты: <b>${paymentLabel}</b>\n\nМенеджер свяжется с вами для подтверждения.`;
    await ctx.reply(userReply, { parse_mode: "HTML" });

  } catch (err) {
    console.error("Ошибка сохранения заказа в БД:", err);
    await ctx.reply("❌ Произошла ошибка при сохранении заказа. Попробуйте еще раз.");
  }
}
// 🚀 ЗАПУСК ВЕБ-СЕРВЕРА И БОТА
async function startApp() {
  await initDb();

  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running!");
  }).listen(PORT, () => {
    console.log(`🌐 Веб-сервер прослушивает порт ${PORT}`);
  });

  bot.start();
  console.log("🚀 Интернет-магазин 2.0 запущен!");
}

startApp();