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
      payment_method TEXT DEFAULT 'cash',
      receipt_photo TEXT,
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
    { name: "Кроссовки Nike Air Force 1 '07", target: "men", category: "shoes", brand: "Nike", price: 8990, image: "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?w=600", sizes: "40,41,42,43,44" },
    { name: "Кроссовки Adidas Ultraboost Light", target: "men", category: "shoes", brand: "Adidas", price: 11490, image: "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=600", sizes: "41,42,43,45" },
    { name: "Кроссовки Nike Air Max Blossom", target: "women", category: "shoes", brand: "Nike", price: 8490, image: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?w=600", sizes: "36,37,38,39" },
    { name: "Футболка Nike Sportswear Tee Black", target: "men", category: "clothes", brand: "Nike", price: 2990, image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600", sizes: "S,M,L,XL" },
    { name: "Футболка Oversize Adidas Originals", target: "women", category: "clothes", brand: "Adidas", price: 3490, image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=600", sizes: "XS,S,M,L" },
    { name: "Детские кроссовки Nike Dynamo GO", target: "kids", category: "kids_shoes", brand: "Nike Kids", price: 4200, image: "https://images.unsplash.com/photo-1514989940723-e8e51635b782?w=600", sizes: "28,29,30,31,32" },
    { name: "Детский костюм H&M Cotton Set", target: "kids", category: "kids_clothes", brand: "H&M", price: 2500, image: "https://images.unsplash.com/photo-1622290291468-a28f7a7dc6a8?w=600", sizes: "110,116,122" },
    { name: "Гарри Поттер и Философский камень", target: "kids", category: "books", brand: "Эксмо", price: 1200, image: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=600", sizes: "nosize" },
    { name: "Конструктор LEGO City Грузовик", target: "kids", category: "toys", brand: "LEGO", price: 3200, image: "https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=600", sizes: "nosize" },
    { name: "Набор шоколадных конфет Ferrero", target: "kids", category: "food", brand: "Ferrero", price: 950, image: "https://images.unsplash.com/photo-1549007994-cb92caebd54b?w=600", sizes: "nosize" },
    { name: "Детский гель Mustela 500мл", target: "kids", category: "cleaning", brand: "Mustela", price: 1650, image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600", sizes: "nosize" }
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
  const idStr = userId.toString();
  if (!userSessions[idStr]) {
    userSessions[idStr] = { cart: [], step: "idle", newProduct: {}, currentTarget: "men" };
  }
  return userSessions[idStr];
}

// 🏁 1. ГЛАВНОЕ МЕНЮ И СТАРТ
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;
  userSessions[userId.toString()] = { cart: [], step: "idle", newProduct: {}, currentTarget: "men" };

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
    text += `Оплата: ${o.payment_method === 'eshata' ? '💳 Эсхата Онлайн' : '💵 Наличные'}\n`;
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
    text += `Тел: ${o.phone} | Сумма: ${o.total_price} | Способ: ${o.payment_method}\n`;
    text += `Статус: ${o.status} | Подтверждён: ${o.is_paid ? "✅ Да" : "❌ Нет"}\n`;
    text += `Состав:\n${o.items}\n--------------------\n`;
  });

  const keyboard = new InlineKeyboard().text("⬅️ В админку", "admin_panel");
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: keyboard });
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

// 🎯 КАТАЛОГ
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

  await ctx.editMessageText("<b>Выберите категорию:</b>", { parse_mode: "HTML", reply_markup: keyboard });
});

// 📦 ПОСТРАНИЧНЫЙ ВЫВОД КАТАЛОГА (ПАГИНАЦИЯ)
bot.callbackQuery(/^cat_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  const session = getSession(ctx.from.id);
  session.currentCategory = category;
  await showProductPage(ctx, category, 0);
});

bot.callbackQuery(/^page_(.+)_(\d+)$/, async (ctx) => {
  const category = ctx.match[1];
  const pageIndex = parseInt(ctx.match[2]);
  await showProductPage(ctx, category, pageIndex);
});

async function showProductPage(ctx, category, pageIndex) {
  const session = getSession(ctx.from.id);
  const target = session.currentTarget || "men";

  const products = await db.all(
    "SELECT * FROM products WHERE category = ? AND (target = ? OR target = 'men')",
    [category, target]
  );

  if (!products || products.length === 0) {
    return ctx.answerCallbackQuery({ text: "⚠️ В этой категории пока нет товаров!", show_alert: true });
  }

  if (pageIndex < 0 || pageIndex >= products.length) pageIndex = 0;
  const item = products[pageIndex];

  const keyboard = new InlineKeyboard();

  if (item.sizes && item.sizes !== "nosize") {
    keyboard.text("📏 Выбрать размер", `select_size_${item.id}`);
  } else {
    keyboard.text(`🛒 В корзину (${item.price} руб.)`, `add_${item.id}_nosize`);
  }
  keyboard.row();

  const prevPage = pageIndex - 1;
  const nextPage = pageIndex + 1;

  if (prevPage >= 0) keyboard.text("⬅️ Назад", `page_${category}_${prevPage}`);
  keyboard.text(`${pageIndex + 1} / ${products.length}`, "ignore");
  if (nextPage < products.length) keyboard.text("Вперед ➡️", `page_${category}_${nextPage}`);

  const caption = `<b>${item.name}</b>\nБренд: ${item.brand}\n\n💰 <b>Цена:</b> ${item.price} руб.`;

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

bot.callbackQuery("ignore", (ctx) => ctx.answerCallbackQuery());

// 📏 ОТОБРАЖЕНИЕ КНОПОК РАЗМЕРОВ
bot.callbackQuery(/^select_size_(\d+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);

  if (!product) return ctx.answerCallbackQuery({ text: "Товар не найден!" });

  const sizes = product.sizes.split(",");
  const keyboard = new InlineKeyboard();

  sizes.forEach((s) => {
    keyboard.text(s.trim(), `add_${productId}_${s.trim()}`);
  });

  await ctx.reply(`<b>Выберите размер для ${product.name}:</b>`, {
    parse_mode: "HTML",
    reply_markup: keyboard
  });
  await ctx.answerCallbackQuery();
});

// 📏 ДОБАВЛЕНИЕ В КОРЗИНУ (УНИФИЦИРОВАННАЯ ЛОГИКА)
bot.callbackQuery(/^add_(\d+)_(.+)$/, async (ctx) => {
  const productId = parseInt(ctx.match[1]);
  const selectedSize = ctx.match[2];
  const product = await db.get("SELECT * FROM products WHERE id = ?", [productId]);

  if (!product) return ctx.answerCallbackQuery({ text: "Ошибка: товар не найден" });

  const session = getSession(ctx.from.id);
  const chosenSize = selectedSize !== "nosize" ? selectedSize : "Единый";

  const existingItem = session.cart.find(i => i.id === product.id && i.chosenSize === chosenSize);

  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    session.cart.push({
      ...product,
      chosenSize: chosenSize,
      quantity: 1
    });
  }

  await ctx.answerCallbackQuery({ text: `✅ ${product.name} (${chosenSize}) добавлен в корзину!` });
});

// 🛒 КОРЗИНА И ИЗМЕНЕНИЕ КОЛИЧЕСТВА
bot.callbackQuery("view_cart", async (ctx) => {
  await renderCart(ctx);
});

async function renderCart(ctx) {
  const session = getSession(ctx.from.id);
  const cart = session.cart || [];

  if (cart.length === 0) {
    const emptyKb = new InlineKeyboard().text("🛍 В каталог", "open_catalog");
    if (ctx.callbackQuery) {
      return ctx.editMessageText("<b>Ваша корзина пуста!</b>", { parse_mode: "HTML", reply_markup: emptyKb });
    }
    return ctx.reply("<b>Ваша корзина пуста!</b>", { parse_mode: "HTML", reply_markup: emptyKb });
  }

  let total = 0;
  let text = "<b>🛒 ВАША КОРЗИНА:</b>\n\n";
  const keyboard = new InlineKeyboard();

  cart.forEach((item, index) => {
    const itemTotal = item.price * item.quantity;
    total += itemTotal;
    text += `${index + 1}. <b>${item.name}</b> (${item.chosenSize})\n`;
    text += `   ${item.quantity} шт. x ${item.price} = <b>${itemTotal} руб.</b>\n\n`;

    keyboard.text(`➖`, `cart_dec_${index}`).text(`${item.quantity} шт`, "ignore").text(`➕`, `cart_inc_${index}`).text(`❌`, `cart_del_${index}`).row();
  });

  text += `💳 <b>Итого к оплате:</b> ${total} руб.`;

  keyboard
    .text("✅ Оформить заказ", "start_checkout")
    .row()
    .text("🗑 Очистить корзину", "clear_cart")
    .row()
    .text("⬅️ В главное меню", "back_to_main");

  if (ctx.callbackQuery) {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }
}

bot.callbackQuery(/^cart_inc_(\d+)$/, async (ctx) => {
  const idx = parseInt(ctx.match[1]);
  const session = getSession(ctx.from.id);
  if (session.cart[idx]) session.cart[idx].quantity += 1;
  await renderCart(ctx);
});

bot.callbackQuery(/^cart_dec_(\d+)$/, async (ctx) => {
  const idx = parseInt(ctx.match[1]);
  const session = getSession(ctx.from.id);
  if (session.cart[idx]) {
    session.cart[idx].quantity -= 1;
    if (session.cart[idx].quantity <= 0) session.cart.splice(idx, 1);
  }
  await renderCart(ctx);
});

bot.callbackQuery(/^cart_del_(\d+)$/, async (ctx) => {
  const idx = parseInt(ctx.match[1]);
  const session = getSession(ctx.from.id);
  if (session.cart[idx]) session.cart.splice(idx, 1);
  await renderCart(ctx);
});

bot.callbackQuery("clear_cart", async (ctx) => {
  getSession(ctx.from.id).cart = [];
  await ctx.answerCallbackQuery({ text: "Корзина очищена!" });
  await renderCart(ctx);
});

// 💳 ОФОРМЛЕНИЕ ЗАКАЗА
bot.callbackQuery("start_checkout", async (ctx) => {
  const session = getSession(ctx.from.id);
  if (!session.cart || session.cart.length === 0) {
    return ctx.answerCallbackQuery({ text: "Корзина пуста!", show_alert: true });
  }

  session.step = "waiting_phone";

  const phoneKeyboard = new Keyboard()
    .requestContact("📱 Поделиться номером телефона")
    .resized()
    .oneTime();

  await ctx.reply("Для оформления заказа поделитесь вашим номером телефона:", { reply_markup: phoneKeyboard });
  await ctx.answerCallbackQuery();
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
  
  if (allProducts.length === 0) return ctx.reply("В базе пока нет товаров.");

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
    kb.text("👟 Обувь", "set_cat_kids_shoes").text("👕 Одежда", "set_cat_kids_clothes")
      .row()
      .text("📚 Книги", "set_cat_books").text("🧸 Игрушки", "set_cat_toys")
      .row()
      .text("🍏 Еда", "set_cat_food").text("🧴 Моющие средства", "set_cat_cleaning");
  } else {
    kb.text("👟 Кроссовки", "set_cat_shoes").row().text("👕 Одежда", "set_cat_clothes");
  }
  await ctx.editMessageText("Шаг 3/7: Выберите категорию:", { reply_markup: kb });
});

bot.callbackQuery(/^set_cat_(.+)$/, async (ctx) => {
  const session = getSession(ctx.from.id);
  session.newProduct.category = ctx.match[1];
  session.step = "add_prod_brand";
  await ctx.reply("Шаг 4/7: Введите бренд товара:");
});

// 💳 ОПЛАТА
bot.callbackQuery(/^pay_(eshata|cash)$/, async (ctx) => {
  const paymentMethod = ctx.match[1];
  const session = getSession(ctx.from.id);
  session.paymentMethod = paymentMethod;

  let total = 0;
  session.cart.forEach((i) => (total += i.price * i.quantity));

  if (paymentMethod === "eshata") {
    session.step = "waiting_receipt";
    const text = 
      `💳 <b>ОПЛАТА ЧЕРЕЗ БАНК ЭСХАТА</b>\n\n` +
      `Пожалуйста, переведите <b>${total} руб.</b> на кошелёк/карту:\n` +
      `📱 <b>Номер:</b> <code>${ESHATA_WALLET}</code>\n` +
      `👤 <b>Получатель:</b> ${ESHATA_CARD_NAME}\n\n` +
      `📸 <b>После оплаты отправьте скриншот чека в этот чат!</b>`;

    await ctx.editMessageText(text, { parse_mode: "HTML" });
  } else {
    await createOrderInDb(ctx.from.id, ctx, "💵 Наличными при получении", null);
  }
});

async function createOrderInDb(userId, ctx, paymentLabel, receiptPhoto) {
  const session = getSession(userId);
  const cart = session.cart || [];
  const username = ctx.from.username ? `@${ctx.from.username}` : "Без username";

  let total = 0;
  let orderDetails = "";

  cart.forEach((item, i) => {
    const sum = item.price * item.quantity;
    orderDetails += `${i + 1}. ${item.name} (${item.chosenSize}) x${item.quantity} — ${sum} руб.\n`;
    total += sum;
  });

  const result = await db.run(
    `INSERT INTO orders (user_id, username, phone, address, items, total_price, payment_method, receipt_photo, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [userId, username, session.phone, session.address, orderDetails, total, paymentLabel, receiptPhoto]
  );

  const orderId = result.lastID;
  session.step = "idle";
  session.cart = [];

  await notifyAdminAboutOrder(orderId, userId, username, session.phone, session.address, orderDetails, total, paymentLabel, receiptPhoto);

  const userReply = `🎉 <b>Заказ №${orderId} успешно оформлен!</b>\nСпособ оплаты: <b>${paymentLabel}</b>\n\nМенеджер свяжется с вами для подтверждения.`;
  
  if (ctx.callbackQuery) {
    await ctx.editMessageText(userReply, { parse_mode: "HTML" });
  } else {
    await ctx.reply(userReply, { parse_mode: "HTML" });
  }
}

// 🛠 ОБРАБОТКА ВВОДА И ВАЛИДАЦИЯ
bot.on("message", async (ctx) => {
  if (ctx.message.text && ctx.message.text.startsWith("/")) return;

  const userId = ctx.from.id;
  session = getSession(userId);

  // ВВОД НОМЕРА ТЕЛЕФОНА ТЕКСТОМ (если пользователь не нажал кнопку)
  if (session.step === "waiting_phone" && ctx.message.text) {
    session.phone = ctx.message.text;
    session.step = "waiting_address";
    return ctx.reply("Спасибо! Теперь введите ваш адрес доставки:");
  }

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

  // АДМИН: ПОШАГОВОЕ ДОБАВЛЕНИЕ С ВАЛИДАЦИЕЙ
  if (session.step === "add_prod_name") {
    session.newProduct.name = ctx.message.text;
    session.step = "idle";
    const kb = new InlineKeyboard().text("👨 Мужское", "set_target_men").text("👩 Женское", "set_target_women").row().text("👶 Детское", "set_target_kids");
    return ctx.reply("Шаг 2/7: Выберите целевую аудиторию:", { reply_markup: kb });
  }

  if (session.step === "add_prod_brand") {
    session.newProduct.brand = ctx.message.text;
    session.step = "add_prod_price";
    return ctx.reply("Шаг 5/7: Введите цену (только положительное число):");
  }

  if (session.step === "add_prod_price") {
    const price = parseInt(ctx.message.text);
    if (isNaN(price) || price <= 0) {
      return ctx.reply("❌ Неверная цена! Пожалуйста, введите положительное число:");
    }
    session.newProduct.price = price;
    session.step = "add_prod_sizes";
    return ctx.reply("Шаг 6/7: Введите размеры через запятую (например 40,41,42) или nosize:");
  }

  if (session.step === "add_prod_sizes") {
    session.newProduct.sizes = ctx.message.text.trim();
    session.step = "add_prod_image";
    return ctx.reply("Шаг 7/7: Отправьте ссылку на картинку (http...) или фото:");
  }

  if (session.step === "add_prod_image") {
    let imageUrl = ctx.message.photo ? ctx.message.photo[ctx.message.photo.length - 1].file_id : ctx.message.text;

    if (!ctx.message.photo && (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
      return ctx.reply("❌ Пожалуйста, отправьте корректную ссылку на изображение (начинающуюся с http:// или https://) или фото!");
    }

    session.newProduct.image = imageUrl;

    await db.run(
      `INSERT INTO products (name, target, category, brand, price, image, sizes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [session.newProduct.name, session.newProduct.target, session.newProduct.category, session.newProduct.brand, session.newProduct.price, session.newProduct.image, session.newProduct.sizes]
    );

    session.step = "idle";
    return ctx.reply(`🎉 Товар "${session.newProduct.name}" успешно добавлен в базу!`);
  }

  // АДРЕС И ЧЕК
  if (session.step === "waiting_address") {
    session.address = ctx.message.text;
    session.step = "idle";

    const keyboard = new InlineKeyboard()
      .text("💳 Карта / Кошелёк Эсхата", "pay_eshata")
      .row()
      .text("💵 Наличными при получении", "pay_cash");

    await ctx.reply("Выберите способ оплаты:", { reply_markup: keyboard });
    return;
  }

  if (session.step === "waiting_receipt") {
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

// УВЕДОМЛЕНИЕ АДМИНА О НОВОМ ЗАКАЗЕ
async function notifyAdminAboutOrder(orderId, userId, username, phone, address, items, total, paymentMethod, receiptPhoto) {
  const adminKeyboard = new InlineKeyboard()
    .text("📦 В работу", `status_proc_${orderId}_${userId}`)
    .text("🚚 В доставку", `status_ship_${orderId}_${userId}`)
    .row()
    .text("✅ Выполнен", `status_done_${orderId}_${userId}`)
    .text("❌ Отменить", `status_canc_${orderId}_${userId}`);

  let adminMessage = `🚨 <b>НОВЫЙ ЗАКАЗ №${orderId}!</b>\n\n`;
  adminMessage += `👤 <b>Покупатель:</b> ${username} (ID: <code>${userId}</code>)\n`;
  adminMessage += `📞 <b>Телефон:</b> <code>${phone}</code>\n`;
  adminMessage += `🏠 <b>Адрес:</b> ${address}\n`;
  adminMessage += `💳 <b>Оплата:</b> ${paymentMethod}\n\n`;
  adminMessage += `📦 <b>Состав:</b>\n${items}\n`;
  adminMessage += `💰 <b>ИТОГО:</b> ${total} руб.\n`;

  try {
    if (receiptPhoto) {
      await bot.api.sendPhoto(ADMIN_CHAT_ID, receiptPhoto, {
        caption: adminMessage + "\n🧾 <b>Чек оплаты прикреплён выше!</b>",
        parse_mode: "HTML",
        reply_markup: adminKeyboard
      });
    } else {
      await bot.api.sendMessage(ADMIN_CHAT_ID, adminMessage, { parse_mode: "HTML", reply_markup: adminKeyboard });
    }
  } catch (e) {
    console.error("Ошибка при отправке заказа админу:", e);
  }
}

bot.catch((err) => console.error("Ошибка:", err));

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