import { IsArray, IsNotEmpty, IsString, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsNotEmpty()
  @IsString()
  role: 'user' | 'assistant';

  @IsNotEmpty()
  @IsString()
  content: string;
}

export class AiChatRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages: ChatMessageDto[];

  @IsOptional()
  @IsString()
  pageId?: string; // Optional: Current page ID for context
}

export class AiChatResponseDto {
  message?: string; // Optional - may be empty if only toolCalls are present
  success: boolean;
  toolCalls?: any[]; // Optional - tool calls for frontend execution
}

