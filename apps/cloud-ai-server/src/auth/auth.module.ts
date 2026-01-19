import { Module } from '@nestjs/common';
import { SubscriptionGuard } from './subscription.guard';
import { SubscriptionService } from './subscription.service';

@Module({
    providers: [SubscriptionGuard, SubscriptionService],
    exports: [SubscriptionGuard, SubscriptionService],
})
export class AuthModule {}
