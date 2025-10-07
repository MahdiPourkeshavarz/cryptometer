import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from 'typeorm';

@Entity()
@Unique(['headline', 'source'])
export class Article {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  headline: string;

  @Column('text')
  summary: string;

  @Column()
  source: string;

  @Column({ nullable: true })
  url?: string;

  @CreateDateColumn()
  createdAt: Date;
}
