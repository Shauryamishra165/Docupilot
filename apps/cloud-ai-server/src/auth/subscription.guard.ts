import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
    private readonly logger = new Logger(SubscriptionGuard.name);

    constructor(private readonly subscriptionService: SubscriptionService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractToken(request);

        if (!token) {
            throw new UnauthorizedException('Subscription token required');
        }

        // Verify subscription
        const subscription = await this.subscriptionService.verifySubscription(
            token,
        );

        if (!subscription || !subscription.isActive) {
            this.logger.warn(`Invalid or expired subscription token`);
            throw new UnauthorizedException(
                'Valid active subscription required for AI features',
            );
        }

        // Check rate limits based on plan
        await this.subscriptionService.checkRateLimit(subscription);

        // Attach subscription info to request
        request.subscription = subscription;
        request.user = subscription.user;

        return true;
    }

    private extractToken(request: any): string | null {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        return null;
    }
}
