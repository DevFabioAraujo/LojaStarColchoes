# Star Colchões

Loja virtual responsiva de colchões, com catálogo, busca, filtros, sacola e checkout. O servidor Node.js/Express disponibiliza os produtos e registra pedidos em um banco SQLite local.

Produtos, preços, avaliações, depoimento, garantias, prazos e condições comerciais são conteúdo demonstrativo: confirme e substitua essas informações antes de publicar. O formulário de novidades também é apenas visual e ainda não está conectado a um serviço de e-mail.

## Requisitos

- Node.js 20.17 ou superior
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

## Estrutura do projeto

- `public/`: páginas HTML, estilos e scripts enviados ao navegador. As páginas dos painéis não são servidas diretamente como arquivos: `/admin` e `/seller` continuam exigindo autorização.
- `src/app.js`: montagem do Express e das rotas.
- `src/routes/`: rotas de autenticação, administração, loja e páginas.
- `src/middleware/`: configuração de segurança e autorização por perfil.
- `src/database.js`: conexão, inicialização e operações SQLite.
- `src/validation.js`: validações e serialização de dados de conta.
- `src/config/paths.js`: diretórios do projeto, arquivos estáticos e dados.
- `src/data/products.js`: catálogo inicial de demonstração.
- `server.js`: inicialização do banco e do servidor HTTP.

Os bancos locais (`data/*.db` e `data/*.sqlite`) são ignorados pelo Git. Configure `DATA_DIRECTORY` para manter esses arquivos fora da pasta do projeto ou em um volume persistente.

## Contas e acessos

- Clientes criam a própria conta em [http://localhost:3000/account](http://localhost:3000/account), usando e-mail e senha.
- É necessário estar conectado para finalizar uma compra. Pedidos ficam associados à conta autenticada, e nome e e-mail vêm do perfil, não dos dados enviados pelo navegador.
- No checkout, ao informar um CEP válido, o ViaCEP preenche endereço, bairro e cidade/UF. Os campos continuam editáveis; número e complemento devem ser conferidos e completados manualmente. Se a consulta falhar, o endereço pode ser preenchido sem autocomplete.
- Vendedores não podem se cadastrar como vendedores. O administrador cria as contas no painel em [http://localhost:3000/admin](http://localhost:3000/admin); o acesso do vendedor fica em [http://localhost:3000/seller](http://localhost:3000/seller).
- O painel de vendedor é, por enquanto, uma área protegida inicial. As funções de vendas serão implementadas em uma próxima etapa.
- Senhas precisam ter pelo menos 12 caracteres e são armazenadas com hash bcrypt. As sessões ficam no servidor em `data/sessions.sqlite`; o cookie é `HttpOnly`, `SameSite=Lax` e expira após 12 horas. Trocar a senha encerra as outras sessões.
- A conta não tem recuperação de senha nem verificação de e-mail nesta etapa. Configure um serviço de e-mail antes de oferecer recuperação ou convites automáticos.

### Criar o primeiro administrador

Configure estas variáveis no terminal antes de iniciar o servidor pela primeira vez. A conta é criada somente se o e-mail ainda não existir; remova as variáveis `BOOTSTRAP_ADMIN_*` depois dessa primeira inicialização.

```powershell
$env:BOOTSTRAP_ADMIN_NAME = "Administrador da loja"
$env:BOOTSTRAP_ADMIN_EMAIL = "admin@example.com"
$env:BOOTSTRAP_ADMIN_PASSWORD = "substitua-por-uma-senha-segura"
$env:SESSION_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
npm start
```

Use senhas e segredos próprios, não os valores de exemplo, e não os inclua no Git. Em produção, mantenha `SESSION_SECRET` estável em um gerenciador de segredos, defina `NODE_ENV=production` e sirva o site somente por HTTPS. Se houver um proxy HTTPS na frente do Node.js, configure também `TRUST_PROXY=1`. O banco pode ser colocado em outro diretório com `DATA_DIRECTORY`.

## API

- `GET /api/products`: lista o catálogo.
- `POST /api/auth/register`: cria uma conta de cliente; nunca aceita a escolha de uma função privilegiada.
- `POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout`: autenticação e sessão.
- `POST /api/auth/password`: troca a senha da conta autenticada e encerra as outras sessões.
- `GET /api/admin/summary`, `/api/admin/products`, `/api/admin/orders`, `/api/admin/customers` e `/api/admin/sellers`: indicadores e consultas administrativas, somente para administradores. `PUT /api/admin/orders/:id` altera cliente, contato, endereço e itens, recalculando o total pelos preços atuais; `DELETE /api/admin/orders/:id` remove o pedido e seus itens.
- `POST /api/admin/products`, `PUT /api/admin/products/:id` e `DELETE /api/admin/products/:id`: criação, edição e exclusão de produtos. Produtos associados a pedidos não podem ser excluídos.
- `GET /api/admin/users` e `PUT /api/admin/users/:id/role`: administradores definem o perfil (cliente, vendedor ou administrador) de cada usuário, o que determina quem acessa o painel. Não é possível alterar o próprio perfil, e a alteração encerra as sessões do usuário afetado.
- `POST /api/admin/sellers`: criação de vendedores, somente para administradores.
- `POST /api/orders`: exige uma conta autenticada, calcula o valor no servidor e salva o pedido e seus itens em uma transação SQLite.

O painel administrativo permite consultar indicadores, gerenciar o catálogo, consultar pedidos e visualizar clientes e vendedores. Pedidos anteriores à autenticação são preservados; a nova coluna de usuário fica vazia para esses registros antigos. O checkout e os pedidos não integram um gateway de pagamento nem têm fluxo de atualização de status. As imagens e fontes são servidas por provedores externos.
