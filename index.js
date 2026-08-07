const { Bot, InlineKeyboard, Keyboard } = require("grammy");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const http = require("http");

require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "8491952252";
const PAYMENT_PROVIDER_TOKEN = process.env.PAYMENT_PROVIDER_TOKEN || "";
const PORT = process.env.PORT || 3000;

const bot = new Bot(BOT_TOKEN);
let db;

// 🗄 ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ
async function initDb() {
  db = await open({
    filename: "./database.db",
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      phone TEXT,
      address TEXT,
      items TEXT,
      total_price INTEGER,
      status TEXT DEFAULT 'new',
      is_paid INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      target TEXT,
      category TEXT,
      brand TEXT,
      price INTEGER,
      image TEXT,
      sizes TEXT
    );
  `);

  const count = await db.get("SELECT COUNT(*) as count FROM products");
  if (count.count === 0) {
    await seedInitialProducts();
  }

  console.log("🗄 База данных SQLite успешно подключена!");
}

async function seedInitialProducts() {
  const initialProducts = [
    { name: "Кроссовки Nike Air Force 1 '07", target: "men", category: "shoes", brand: "Nike", price: 8990, image: "https://i.imgur.com/8Qp5Y6B.jpeg", sizes: "40,41,42,43,44" },
    { name: "Кроссовки Adidas Ultraboost Light", target: "men", category: "shoes", brand: "Adidas", price: 11490, image: "https://i.imgur.com/8Qp5Y6B.jpeg", sizes: "41,42,43,45" },
    { name: "Кроссовки Nike Air Max Blossom", target: "women", category: "shoes", brand: "Nike", price: 8490, image: "https://i.imgur.com/8Qp5Y6B.jpeg", sizes: "36,37,38,39" },
    { name: "Футболка Nike Sportswear Tee Black", target: "men", category: "clothes", brand: "Nike", price: 2990, image: "https://i.imgur.com/8Qp5Y6B.jpeg", sizes: "S,M,L,XL" },
    { name: "Книга Гарри Поттер и Философский камень", target: "kids", category: "books", brand: "Книги", price: 1200, image: "https://i.imgur.com/8Qp5Y6B.jpeg", sizes: "nosize" }
  ];

  for (const p of initialProducts) {
    await db.run(
      `INSERT INTO products (name, target, category, brand, price, image, sizes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.name, p.target, p.category, p.brand, p.price, p.image, p.sizes]
    );
  }
}

const userSessions = {};

function getSession(userId) {
  if (!userSessions[userId]) {
    userSessions[userId] = { cart: [], step: "idle", newProduct: {} };
  }
  return userSessions[userId];
}

// 🏁 1. ГЛАВНОЕ МЕНЮ И СТАРТ
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;
  userSessions[userId] = { cart: [], step: "idle", newProduct: {} };

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

  const text = "👑 <b>Панель администратора:</b>\nВыберите необходимое действие:";
  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

// 📜 ИСТОРИЯ ЗАКАЗОВ ДЛЯ ПОЛЬЗОВАТЕЛЯ
bot.callbackQuery("my_orders", async (ctx) => {
  const userId = ctx.from.id;
  const orders = await db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10", [userId]);

  if (orders.length === 0) {
    return ctx.answerCallbackQuery({ text: "У вас пока нет заказов!", show_alert: true });
  }

  let text = "<b>📜 ВАШИ ПОСЛЕДНИЕ ЗАКАЗЫ:</b>\n\n";
  orders.forEach((o) => {
    text += `📦 <b>Заказ №${o.id}</b> | ${o.total_price} руб.\n`;
    text += `Статус: ${o.status} | Дата: ${o.created_at}\n`;
    text += `Состав:\n${o.items}\n--------------------\n`;
  });

  const keyboard = new InlineKeyboard().text("⬅️ Назад", "back_to_main");
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
});

// 📜 ИСТОРИЯ ВСЕХ ЗАКАЗОВ ДЛЯ АДМИНА
bot.callbackQuery("admin_orders", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;

  const orders = await db.all("SELECT * FROM orders ORDER BY id DESC LIMIT 10");

  if (orders.length === 0) {
    return ctx.answerCallbackQuery({ text: "Заказов в базе нет!", show_alert: true });
  }

  let text = "<b>📜 ПОСЛЕДНИЕ 10 ЗАКАЗОВ (АДМИН):</b>\n\n";
  orders.forEach((o) => {
    text += `🚨 <b>Заказ №${o.id}</b> (${o.username})\n`;
    text += `Тел: ${o.phone} | Сумма: ${o.total_price} руб.\n`;
    text += `Статус: ${o.status} | Оплата: ${o.is_paid ? "✅ Да" : "❌ Нет"}\n`;
    text += `Состав:\n${o.items}\n--------------------\n`;
  });

  const keyboard = new InlineKeyboard().text("⬅️ В админку", "admin_panel");
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
});

// ❓ 2. РАЗДЕЛ FAQ И СВЯЗЬ С МЕНЕДЖЕРОМ
bot.callbackQuery("show_faq", async (ctx) => {
  const faqText = 
    `<b>❓ ЧАСТО ЗАДАВАЕМЫЕ ВОПРОСЫ</b>\n\n` +
    `<b>🚚 Доставка:</b> Доставка осуществляется от 2 до 5 дней.\n\n` +
    `<b>💳 Оплата:</b> Онлайн картой в Telegram или при получении.\n\n` +
    `<b>🔄 Возврат:</b> В течение 14 дней.`;

  const keyboard = new InlineKeyboard()
    .text("💬 Задать вопрос менеджеру", "ask_manager")
    .row()
    .text("⬅️ Главное меню", "back_to_main");

  await ctx.editMessageText(faqText, { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery("ask_manager", async (ctx) => {
  const session = getSession(ctx.from.id);
  session.step = "waiting_question";

  await ctx.reply("💬 <b>Напишите ваш вопрос для менеджера.</b>\nМы ответим вам прямо в этом чате!", { parse_mode: "HTML" });
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

  await ctx.editMessageText("<b>Главное меню:</b>", { parse_mode: "HTML", reply_markup: keyboard });
});

// 🎯 3. КАТАЛОГ И ТОВАРЫ
bot.callbackQuery("open_catalog", async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("👨 Я Мужчина", "gender_m")
    .text("👩 Я Женщина", "gender_w");

  await ctx.editMessageText("<b>Укажите ваш пол:</b>", { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery(/^gender_(m|w)$/, async (ctx) => {
  const keyboard = new InlineKeyboard()
    .text("👨 Для Мужчин", "target_men")
    .row()
    .text("👩 Для Женщин", "target_women")
    .row()
    .text("👶 Для Детей", "target_kids");

  await ctx.editMessageText("<b>Для кого вы хотите подобрать товары?</b>", { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery(/^target_(men|women|kids)$/, async (ctx) => {
  const target = ctx.match[1];
  const session = getSession(ctx.from.id);
  session.currentTarget = target;

  const keyboard = new InlineKeyboard();

  if (target === "kids") {
    keyboard.text("📚 Книги", "cat_books").row().text("🧸 Игрушки", "cat_toys");
  } else {
    keyboard.text("👟 Кроссовки", "cat_shoes").row().text("👕 Футболки", "cat_clothes");
  }

  await ctx.editMessageText("<b>Выберите категорию:</b>", { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery(/^cat_(shoes|clothes|books|toys)$/, async (ctx) => {
  const category = ctx.match[1];
  const session = getSession(ctx.from.id);
  const target = session.currentTarget || "men";

  const filteredProducts = await db.all(
    "SELECT * FROM products WHERE category = ? AND (target = ? OR target = 'kids')",
    [category, target]
  );

  if (filteredProducts.length === 0) {
    return ctx.answerCallbackQuery({ text: "Товары скоро появятся!", show_alert: true });
  }

  await ctx.reply(`<b>📦 Каталог товаров (${filteredProducts.length}):</b>`, { parse_mode: "HTML" });

  for (const item of filteredProducts) {
    const keyboard = new InlineKeyboard();

    if (item.sizes && item.sizes !== "nosize") {
      keyboard.text("📏 Выбрать размер", `select_size_${item.id}`);
    } else {
      keyboard.text(`🛒 В корзину (${item.price} руб.)`, `add_${item.id}_nosize`);
    }

    await ctx.replyWithPhoto(item.image, {
      caption: `<b>${item.name}</b>\nБренд: ${item.brand}\n\n💰 <b>Цена:</b> ${item.price} руб.`,
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  }
});

// 📏 4. ДОБАВЛЕНИЕ В КОРЗИНУ И РАЗМЕРЫ
bot.callbackQuery(/^select_size_(\d+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);
  
  const keyboard = new InlineKeyboard();
  const sizesList = product.sizes.split(",");

  sizesList.forEach((size, index) => {
    keyboard.text(`Размер: ${size}`, `add_${product.id}_${size}`);
    if ((index + 1) % 2 === 0) keyboard.row();
  });

  await ctx.reply(`<b>Выберите размер для:</b> ${product.name}`, { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery(/^add_(\d+)_(.+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const selectedSize = ctx.match[2];
  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);
  const session = getSession(ctx.from.id);
  
  session.cart.push({
    ...product,
    chosenSize: selectedSize !== "nosize" ? selectedSize : "Единый"
  });

  await ctx.reply(`✅ <b>${product.name}</b> добавлен в корзину!`, { parse_mode: "HTML" });
});

// 💳 5. КОРЗИНА И ОФОРМЛЕНИЕ ЗАКАЗА
bot.callbackQuery("view_cart", async (ctx) => {
  const session = getSession(ctx.from.id);
  const cart = session.cart || [];

  if (cart.length === 0) {
    return ctx.answerCallbackQuery({ text: "Ваша корзина пуста!", show_alert: true });
  }

  let total = 0;
  let text = "<b>🛒 ВАША КОРЗИНА:</b>\n\n";

  cart.forEach((item, i) => {
    text += `${i + 1}. <b>${item.name}</b>\n  Размер: ${item.chosenSize} | Цена: ${item.price} руб.\n\n`;
    total += item.price;
  });

  text += `💳 <b>Итого к оплате:</b> ${total} руб.`;

  const keyboard = new InlineKeyboard()
    .text("✅ Оформить заказ", "start_checkout")
    .row()
    .text("🗑 Очистить корзину", "clear_cart");

  await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
});

bot.callbackQuery("start_checkout", async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session.cart || session.cart.length === 0) return;

  session.step = "waiting_phone";

  const phoneKeyboard = new Keyboard()
    .requestContact("📱 Поделиться номером телефона")
    .resized()
    .oneTime();

  await ctx.reply("Для оформления заказа поделитесь вашим номером телефона:", { reply_markup: phoneKeyboard });
});

bot.on(":contact", async (ctx) => {
  const session = getSession(ctx.from.id);
  if (session.step === "waiting_phone") {
    session.phone = ctx.message.contact.phone_number;
    session.step = "waiting_address";

    await ctx.reply("Спасибо! Теперь введите ваш адрес доставки:", { reply_markup: { remove_keyboard: true } });
  }
});

// ➕ ДОБАВЛЕНИЕ И УДАЛЕНИЕ ТОВАРОВ (АДМИН)
bot.callbackQuery("start_add_product", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const session = getSession(ctx.from.id);
  session.step = "add_prod_name";
  session.newProduct = {};
  await ctx.reply("➕ <b>Добавление товара (Шаг 1/7):</b> Введите название товара:", { parse_mode: "HTML" });
});

bot.callbackQuery("start_del_product", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const allProducts = await db.all("SELECT * FROM products ORDER BY id DESC");
  
  if (allProducts.length === 0) {
    return ctx.reply("В базе пока нет товаров.");
  }

  for (const item of allProducts) {
    const keyboard = new InlineKeyboard().text(`❌ Удалить (${item.name})`, `del_prod_${item.id}`);
    await ctx.replyWithPhoto(item.image, { caption: `<b>[ID: ${item.id}] ${item.name}</b>`, parse_mode: "HTML", reply_markup: keyboard });
  }
});

bot.callbackQuery(/^del_prod_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  await db.run("DELETE FROM products WHERE id = ?", [ctx.match[1]]);
  await ctx.answerCallbackQuery({ text: "✅ Удалено!" });
  await ctx.editMessageCaption({ caption: "❌ <b>ТОВАР УДАЛЕН</b>", parse_mode: "HTML" });
});

bot.callbackQuery(/^set_target_(men|women|kids)$/, async (ctx) => {
  const session = getSession(ctx.from.id);
  session.newProduct.target = ctx.match[1];
  
  const kb = new InlineKeyboard();
  if (session.newProduct.target === "kids") {
    kb.text("📚 Книги", "set_cat_books").row().text("🧸 Игрушки", "set_cat_toys");
  } else {
    kb.text("👟 Кроссовки", "set_cat_shoes").row().text("👕 Футболки", "set_cat_clothes");
  }
  await ctx.editMessageText("Шаг 3/7: Выберите категорию:", { reply_markup: kb });
});

bot.callbackQuery(/^set_cat_(shoes|clothes|books|toys)$/, async (ctx) => {
  const session = getSession(ctx.from.id);
  session.newProduct.category = ctx.match[1];
  session.step = "add_prod_brand";
  await ctx.reply("Шаг 4/7: Введите бренд товара:");
});

// 🛠 6. ОБРАБОТКА ВСЕХ ВВОДОВ (СООБЩЕНИЯ)
bot.on("message", async (ctx) => {
  if (ctx.message.text && ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  const session = getSession(userId);

  // ВОПРОС МЕНЕДЖЕРУ
  if (session.step === "waiting_question") {
    session.step = "idle";
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
  if (session.step && session.step.startsWith("replying_to_")) {
    const targetUserId = session.step.replace("replying_to_", "");
    session.step = "idle";

    try {
      await bot.api.sendMessage(targetUserId, `💬 <b>Ответ от менеджера:</b>\n\n${ctx.message.text}`, { parse_mode: "HTML" });
      return ctx.reply("✅ Ответ успешно доставлен клиенту!");
    } catch (e) {
      return ctx.reply("❌ Не удалось отправить ответ пользователю.");
    }
  }

  // АДМИН: ПОШАГОВОЕ ДОБАВЛЕНИЕ
  if (session.step === "add_prod_name") {
    session.newProduct.name = ctx.message.text;
    session.step = "idle";
    const kb = new InlineKeyboard().text("👨 Мужское", "set_target_men").text("👩 Женское", "set_target_women").row().text("👶 Детское", "set_target_kids");
    return ctx.reply("Шаг 2/7: Выберите целевую аудиторию:", { reply_markup: kb });
  }

  if (session.step === "add_prod_brand") {
    session.newProduct.brand = ctx.message.text;
    session.step = "add_prod_price";
    return ctx.reply("Шаг 5/7: Введите цену (только число):");
  }

  if (session.step === "add_prod_price") {
    const price = parseInt(ctx.message.text);
    if (isNaN(price)) return ctx.reply("❌ Введите число!");
    session.newProduct.price = price;
    session.step = "add_prod_sizes";
    return ctx.reply("Шаг 6/7: Введите размеры через запятую (например 40,41,42) или nosize:");
  }

  if (session.step === "add_prod_sizes") {
    session.newProduct.sizes = ctx.message.text.trim();
    session.step = "add_prod_image";
    return ctx.reply("Шаг 7/7: Отправьте ссылку на картинку товара:");
  }

  if (session.step === "add_prod_image") {
    let imageUrl = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.text;
    session.newProduct.image = imageUrl;

    await db.run(
      `INSERT INTO products (name, target, category, brand, price, image, sizes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [session.newProduct.name, session.newProduct.target, session.newProduct.category, session.newProduct.brand, session.newProduct.price, session.newProduct.image, session.newProduct.sizes]
    );

    session.step = "idle";
    return ctx.reply(`🎉 Товар "${session.newProduct.name}" успешно добавлен в базу!`);
  }

  // ОФОРМЛЕНИЕ ЗАКАЗА
  if (session.step === "waiting_address") {
    session.address = ctx.message.text;
    session.step = "idle";

    const cart = session.cart || [];
    const username = ctx.from.username ? `@${ctx.from.username}` : "Без username";

    let total = 0;
    let orderDetails = "";

    cart.forEach((item, i) => {
      orderDetails += `${i + 1}. ${item.name} (Размер: ${item.chosenSize}) — ${item.price} руб.\n`;
      total += item.price;
    });

    const result = await db.run(
      `INSERT INTO orders (user_id, username, phone, address, items, total_price, status) VALUES (?, ?, ?, ?, ?, ?, 'new')`,
      [userId, username, session.phone, session.address, orderDetails, total]
    );

    const orderId = result.lastID;

    await notifyAdminAboutOrder(orderId, userId, username, session.phone, session.address, orderDetails, total, false);
    await ctx.reply(`🎉 <b>Заказ №${orderId} успешно оформлен!</b>\nМенеджер свяжется с вами.`, { parse_mode: "HTML" });

    session.cart = [];
  }
});

// КНОПКА ОТВЕТА КЛИЕНТУ
bot.callbackQuery(/^reply_user_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const targetUserId = ctx.match[1];
  const session = getSession(ctx.from.id);
  session.step = `replying_to_${targetUserId}`;

  await ctx.reply(`✍️ Введите текст ответа для пользователя (ID: ${targetUserId}):`);
});

bot.callbackQuery(/^status_(proc|ship|done|canc)_(\d+)_(\d+)$/, async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return;
  const statusMap = { proc: "⚙️ В обработке", ship: "🚚 В доставке", done: "✅ Выполнен", canc: "❌ Отменен" };
  await db.run("UPDATE orders SET status = ? WHERE id = ?", [statusMap[ctx.match[1]], ctx.match[2]]);
  await ctx.answerCallbackQuery({ text: `Статус изменен: ${statusMap[ctx.match[1]]}` });
});

bot.callbackQuery("clear_cart", async (ctx) => {
  getSession(ctx.from.id).cart = [];
  await ctx.editMessageText("🗑 Корзина очищена.");
});

async function notifyAdminAboutOrder(orderId, userId, username, phone, address, items, total, isPaid) {
  const adminKeyboard = new InlineKeyboard()
    .text("📦 В работу", `status_proc_${orderId}_${userId}`)
    .text("🚚 В доставку", `status_ship_${orderId}_${userId}`)
    .row()
    .text("✅ Выполнен", `status_done_${orderId}_${userId}`)
    .text("❌ Отменить", `status_canc_${orderId}_${userId}`);

  let adminMessage = `🚨 <b>НОВЫЙ ЗАКАЗ №${orderId}!</b>\n\n`;
  adminMessage += `👤 <b>Покупатель:</b> ${username} (ID: <code>${userId}</code>)\n`;
  adminMessage += `📞 <b>Телефон:</b> <code>${phone}</code>\n`;
  adminMessage += `🏠 <b>Адрес:</b> ${address}\n\n`;
  adminMessage += `📦 <b>Состав:</b>\n${items}\n`;
  adminMessage += `💰 <b>ИТОГО:</b> ${total} руб.\n`;

  try {
    await bot.api.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: "HTML", reply_markup: adminKeyboard });
  } catch (e) {}
}

bot.catch((err) => console.error("Ошибка:", err));

// 🚀 ЗАПУСК ВЕБ-СЕРВЕРА И БОТА
async function startApp() {
  await initDb();
  
  // Сервер для обхода ошибки Port scan timeout на Render
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot is running!");
  }).listen(PORT, () => {
    console.log(`🌐 Веб-сервер прослушивает порт ${PORT}`);
  });

  bot.start();
  console.log("🚀 Интернет-магазин 2.0 успешно запущен!");
}

startApp();