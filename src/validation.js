function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function validateProduct(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Informe os dados do produto." };
  }

  const { name, category, description, size, price, original_price, badge, image } = input;
  if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 100) {
    return { error: "O nome deve ter entre 3 e 100 caracteres." };
  }
  if (!["espuma", "molas", "hibrido"].includes(category)) {
    return { error: "Selecione uma categoria válida." };
  }
  if (typeof description !== "string" || !description.trim() || description.trim().length > 500) {
    return { error: "A descrição deve ter entre 1 e 500 caracteres." };
  }
  if (typeof size !== "string" || !size.trim() || size.trim().length > 100) {
    return { error: "Informe um tamanho de até 100 caracteres." };
  }
  if (!Number.isSafeInteger(price) || price < 1) {
    return { error: "O preço deve ser um valor inteiro positivo em reais." };
  }
  const originalPrice = original_price === "" || original_price === null || original_price === undefined
    ? null
    : original_price;
  if (originalPrice !== null && (!Number.isSafeInteger(originalPrice) || originalPrice <= price)) {
    return { error: "O preço original deve ser inteiro e maior que o preço atual." };
  }
  if (badge !== undefined && (typeof badge !== "string" || badge.trim().length > 40)) {
    return { error: "O selo deve ter no máximo 40 caracteres." };
  }
  if (typeof image !== "string" || image.length > 2048) {
    return { error: "Informe uma imagem válida para o produto." };
  }
  let parsedImage;
  try {
    parsedImage = new URL(image);
  } catch {
    return { error: "Informe uma URL HTTPS válida para a imagem." };
  }
  if (parsedImage.protocol !== "https:") {
    return { error: "A URL da imagem deve usar HTTPS." };
  }

  return {
    product: {
      name: name.trim(),
      category,
      description: description.trim(),
      size: size.trim(),
      price,
      originalPrice,
      badge: typeof badge === "string" ? badge.trim() : "",
      image: parsedImage.toString(),
    },
  };
}

function validateName(name) {
  return typeof name === "string" && name.trim().length >= 3 && name.trim().length <= 100;
}

function passwordError(password) {
  if (typeof password !== "string" || password.length < 12) {
    return "A senha deve ter pelo menos 12 caracteres.";
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    return "A senha deve ter no máximo 72 bytes.";
  }
  return null;
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

module.exports = { normalizeEmail, validateProduct, validateName, passwordError, safeUser };
