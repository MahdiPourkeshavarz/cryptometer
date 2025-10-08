/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IndicatorModule } from './indicator/indicator.module';
import { ProcessorModule } from './processor/processor.module';
import { ScraperModule } from './scraper/scraper.module';
import { ScheduleModule } from '@nestjs/schedule';
import { MongooseConfigModule } from './mongoose/mongooseConfigModule';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    IndicatorModule,
    ProcessorModule,
    ScraperModule,
    ScheduleModule.forRoot(),
    MongooseConfigModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
