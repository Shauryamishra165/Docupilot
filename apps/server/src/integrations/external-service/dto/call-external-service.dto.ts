import { IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class CallExternalServiceDto {
  @IsNotEmpty()
  @IsString()
  endpoint: string;

  @IsNotEmpty()
  @IsString()
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  @IsOptional()
  @IsObject()
  body?: Record<string, any>;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsObject()
  query?: Record<string, string>;
}

export class ExternalServiceResponseDto {
  status: number;
  data: any;
  headers?: Record<string, string>;
}

