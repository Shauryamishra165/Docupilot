import { IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
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
}

export class AiChatResponseDto {
  message: string;
  success: boolean;
}

