import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';

export class ExternalServiceConfigDto {
  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(300000)
  timeout?: number;
}

