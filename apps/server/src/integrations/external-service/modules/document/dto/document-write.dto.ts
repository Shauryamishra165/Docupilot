import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsObject,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RangeDto {
  @IsNumber()
  @Min(0)
  from: number;

  @IsNumber()
  @Min(0)
  to: number;
}

export class ReplaceDocumentRequestDto {
  @IsString()
  @IsNotEmpty()
  pageId: string; // Can be UUID or slugId

  @IsNotEmpty()
  content: string | object; // JSON string, HTML string, Markdown string, or JSON object

  @IsOptional()
  @IsEnum(['json', 'html', 'markdown', 'text'])
  contentType?: 'json' | 'html' | 'markdown' | 'text' = 'json';
}

export class ReplaceDocumentResponseDto {
  pageId: string;
  success: boolean;
  message?: string;
}

export class InsertContentRequestDto {
  @IsString()
  @IsNotEmpty()
  pageId: string; // Can be UUID or slugId

  @IsNotEmpty()
  content: string | object; // JSON string, HTML string, Markdown string, Text string, or JSON object

  @IsOptional()
  @IsEnum(['json', 'html', 'markdown', 'text'])
  contentType?: 'json' | 'html' | 'markdown' | 'text' = 'json';

  @IsOptional()
  @IsEnum(['cursor', 'start', 'end'])
  position?: 'cursor' | 'start' | 'end' = 'end';

  @IsOptional()
  @IsNumber()
  @Min(0)
  positionOffset?: number; // Character offset for cursor position
}

export class InsertContentResponseDto {
  pageId: string;
  success: boolean;
  message?: string;
  insertedAt?: number; // Character position where content was inserted
}

export class ReplaceRangeRequestDto {
  @IsString()
  @IsNotEmpty()
  pageId: string; // Can be UUID or slugId

  @IsNumber()
  @Min(0)
  from: number; // Start character position

  @IsNumber()
  @Min(0)
  to: number; // End character position

  @IsNotEmpty()
  content: string | object; // JSON string, HTML string, Markdown string, Text string, or JSON object

  @IsOptional()
  @IsEnum(['json', 'html', 'markdown', 'text'])
  contentType?: 'json' | 'html' | 'markdown' | 'text' = 'json';
}

export class ReplaceRangeResponseDto {
  pageId: string;
  success: boolean;
  message?: string;
  replacedFrom?: number;
  replacedTo?: number;
}

