import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number, 1 special char
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(value);
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be at least 8 characters and contain uppercase, lowercase, number and special character`;
  }
}

export function IsStrongPassword() {
  return function (target: object, propertyKey?: string | symbol) {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyKey as string,
      constraints: [],
      validator: IsStrongPasswordConstraint,
    });
  };
}
