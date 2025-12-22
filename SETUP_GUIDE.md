# Farm2Fork Backend - Project Setup Guide

## 📋 Project Structure

The project follows NestJS best practices with a modular, scalable architecture:

```
src/
├── config/                    # Configuration management
│   ├── app.config.ts         # Application settings
│   ├── swagger.config.ts      # Swagger/OpenAPI configuration
│   ├── validation.config.ts   # Global validation rules
│   └── index.ts              # Config exports
├── common/                    # Shared utilities and DTOs
│   ├── dtos/
│   │   ├── pagination.dto.ts # Pagination DTOs
│   │   ├── response.dto.ts    # Response format DTOs
│   │   └── index.ts
│   └── validators/
│       ├── phone.validator.ts # Custom phone validation
│       ├── password.validator.ts # Custom password validation
│       ├── validation.util.ts # Validation utilities
│       └── index.ts
├── modules/                   # Feature modules
│   └── products/             # Example products module
│       ├── dto/
│       │   ├── create-product.dto.ts
│       │   ├── update-product.dto.ts
│       │   ├── product-response.dto.ts
│       │   └── index.ts
│       ├── products.service.ts
│       ├── products.controller.ts
│       └── products.module.ts
├── app.controller.ts         # Root controller
├── app.service.ts           # Root service
├── app.module.ts            # Root module
└── main.ts                  # Application entry point
```

## 🔧 Configuration

### Environment Variables

The project uses `.env` files for configuration. See `.env.example` for available options:

```bash
# Application
NODE_ENV=development
PORT=3000
API_PREFIX=api
API_VERSION=v1

# Database (when you add database)
DATABASE_URL=postgresql://user:password@localhost:5432/farm2fork

# JWT (when you add authentication)
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRATION=24h

# Swagger
SWAGGER_ENABLED=true
SWAGGER_PATH=api/docs
```

**Note:** All environment variables are validated using Joi schema at startup.

## 📦 Installed Packages

### Core Dependencies

- `@nestjs/common` - Core framework
- `@nestjs/config` - Configuration management
- `@nestjs/platform-express` - HTTP platform
- `@nestjs/swagger` - API documentation
- `class-validator` - DTO validation
- `class-transformer` - DTO transformation
- `joi` - Environment variable validation

### Development Dependencies

- TypeScript, ESLint, Prettier
- Testing: Jest, Supertest
- NestJS CLI and Schematics

## 🚀 Getting Started

### Installation

```bash
# Install dependencies
pnpm install
```

### Development

```bash
# Start development server with watch mode
pnpm start:dev

# The API will be available at: http://localhost:3000/api
# Swagger docs will be available at: http://localhost:3000/api/docs
```

### Build & Production

```bash
# Build for production
pnpm build

# Run production build
pnpm start:prod
```

## 📚 Key Features

### 1. Global Validation Pipe

- Automatic DTO validation
- Whitelist properties (removes unknown properties)
- Transform types (e.g., string to number)
- Custom error formatting

### 2. Swagger/OpenAPI Documentation

- Automatically generated from code
- JWT authentication support
- Multiple server configuration
- Interactive UI at `/api/docs`

### 3. Environment Configuration

- Type-safe configuration
- Schema validation with Joi
- Separate config files for different features
- Global ConfigService access

### 4. Custom Validators

- Phone number validation
- Password strength validation
- Easily extensible for more validators

### 5. Response DTOs

- Consistent response format
- `SuccessResponseDto` - Single item responses
- `PaginatedResponseDto` - List responses with pagination
- `ErrorResponseDto` - Error responses

## 📝 Creating New Modules

Follow this pattern for consistency:

```bash
# Create module folder
mkdir -p src/modules/users/dto

# Create files:
# - users/dto/create-user.dto.ts (input validation)
# - users/dto/update-user.dto.ts (extends CreateUserDto with PartialType)
# - users/dto/user-response.dto.ts (response shape)
# - users/dto/index.ts (exports)
# - users/users.service.ts (business logic)
# - users/users.controller.ts (API endpoints)
# - users/users.module.ts (module configuration)
```

## 🔍 API Endpoints

### Health Check

```
GET /health
```

### Products (Example Module)

```
GET    /api/products              # List products with pagination
GET    /api/products/:id          # Get product by ID
POST   /api/products              # Create product
PUT    /api/products/:id          # Update product
DELETE /api/products/:id          # Delete product
```

## ✅ Validation Examples

### In DTOs

```typescript
import { IsString, IsNumber, Min, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ description: 'Product name' })
  @IsString()
  @Length(3, 100)
  name: string;

  @ApiProperty({ description: 'Product price' })
  @IsNumber()
  @Min(0.01)
  price: number;
}
```

### Custom Validators

```typescript
import { IsStrongPassword } from '@/common/validators';

export class CreateUserDto {
  @IsStrongPassword()
  password: string;
}
```

## 🎯 Best Practices Implemented

1. **Modular Architecture** - Features organized in modules
2. **Separation of Concerns** - Controllers, Services, DTOs clearly separated
3. **Type Safety** - Full TypeScript with strict mode
4. **Documentation** - Swagger/OpenAPI integrated
5. **Validation** - Input validation at API boundary
6. **Configuration** - Environment-based configuration
7. **Error Handling** - Consistent error responses
8. **Pagination** - Built-in pagination support
9. **CORS Enabled** - Cross-origin requests allowed
10. **Code Formatting** - Prettier and ESLint configured

## 🔐 Security Considerations

### Implemented

- CORS configured
- Input validation
- SQL injection prevention (with proper ORM)
- Type safety with TypeScript

### To Add

- Authentication (JWT)
- Authorization (Roles/Permissions)
- Rate limiting
- Helmet security headers
- Password hashing
- Database encryption

## 📖 Useful Commands

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:cov

# Run e2e tests
pnpm test:e2e

# Format code
pnpm format

# Lint code
pnpm lint
```

## 🤝 Next Steps

1. **Add Database** - Install TypeORM/Prisma and configure
2. **Add Authentication** - Implement JWT strategy
3. **Add Authorization** - Implement role-based access control
4. **Add Logging** - Implement Winston or similar
5. **Add Error Handling** - Create custom exception filters
6. **Add Caching** - Implement Redis caching
7. **Add Testing** - Write unit and e2e tests

## 📚 Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Swagger/OpenAPI Spec](https://swagger.io)
- [class-validator Documentation](https://github.com/typestack/class-validator)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs)

---

**Created:** December 22, 2025
**Project:** Farm2Fork Backend API
