import { IsNotEmpty, IsString, IsOptional, IsIn, IsObject } from 'class-validator';

export class AiTextTransformRequestDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['improve', 'fix-grammar', 'change-tone'])
  command: 'improve' | 'fix-grammar' | 'change-tone';

  @IsNotEmpty()
  @IsString()
  blockTextWithBrackets: string;

  @IsNotEmpty()
  @IsString()
  selectedText: string;

  @IsOptional()
  @IsObject()
  options?: {
    tone?: 'formal' | 'casual' | 'professional' | 'friendly';
  };
}

export class AiTextTransformResponseDto {
  success: boolean;
  transformedBlockText?: string;
  modifiedText?: string;
  error?: string;
}

