import { AppConfig } from './validateAppConfig';

export type RecipeConfig = {
  firstFactors: NonNullable<AppConfig['template']>['firstFactors'];
  secondFactors?: NonNullable<AppConfig['template']>['secondFactors'];
  providers?: NonNullable<AppConfig['template']>['providers'];
};
