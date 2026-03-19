import { IsString, IsNotEmpty, Length } from "class-validator";

export class InitiateIdentityDto {
  @IsString()
  @IsNotEmpty()
  @Length(10, 10, { message: "National ID / Iqama must be exactly 10 digits" })
  nationalId: string;
}

export class CheckIdentityStatusDto {
  @IsString()
  @IsNotEmpty()
  transactionId: string;
}
