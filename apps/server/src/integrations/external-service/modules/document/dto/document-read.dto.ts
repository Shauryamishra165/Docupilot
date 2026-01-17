import {
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsString,
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

export class DocumentReadRequestDto {
  @IsString()
  @IsNotEmpty()
  pageId: string; // Can be UUID or slugId - PageService.findById handles both

  @IsOptional()
  @IsEnum(['json', 'text', 'html', 'markdown'])
  format?: 'json' | 'text' | 'html' | 'markdown' = 'text';

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RangeDto)
  range?: RangeDto; // Optional range for partial document reading

  @IsOptional()
  @IsBoolean()
  includeMetadata?: boolean = false;
}

export class DocumentReadResponseDto {
  pageId: string;
  title: string;
  content: string; // Formatted content based on format parameter
  format: string;
  metadata?: {
    wordCount: number;
    characterCount: number;
    createdAt: string;
    updatedAt: string;
    author?: string;
  };
  success: boolean;
}

