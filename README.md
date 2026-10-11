# Star Colchões

Loja virtual responsiva de colchões, com catálogo, busca, filtros, sacola e checkout. O servidor Node.js/Express disponibiliza os produtos e registra pedidos em um banco SQLite local.

Produtos, preços, avaliações, depoimento, garantias, prazos e condições comerciais são conteúdo demonstrativo: confirme e substitua essas informações antes de publicar. O formulário de novidades também é apenas visual e ainda não está conectado a um serviço de e-mail.

## Requisitos

- Node.js 18 ou superior
- npm

## Executar localmente

```bash
npm install
npm start
```

Acesse [http://localhost:3000](http://localhost:3000). O banco SQLite é criado automaticamente em `data/star-colchoes.db`, junto com os produtos de demonstração.

Para desenvolvimento com reinicialização automática:

```bash
npm run dev
```

## API

- `GET /api/products`: lista o catálogo.
- `POST /api/orders`: valida cliente e itens, calcula o valor no servidor e salva o pedido e seus itens em uma transação SQLite.

O checkout demonstra a captura do pedido, mas não integra um gateway de pagamento. As imagens e fontes são servidas por provedores externos.
