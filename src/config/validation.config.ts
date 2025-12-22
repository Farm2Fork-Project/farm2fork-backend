export interface IValidationConfig {
  skipMissingProperties: boolean;
  whitelist: boolean;
  forbidNonWhitelisted: boolean;
  transform: boolean;
  transformOptions: {
    enableImplicitConversion: boolean;
  };
}

export const validationConfig = (): IValidationConfig => {
  return {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  };
};
