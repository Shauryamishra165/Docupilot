import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class SimilaritySearchDto {
    @IsString()
    query: string;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1)
    threshold?: number;

    @IsOptional()
    @IsString() // Accepts both UUID and slugId
    pageId?: string;
}
